#!/usr/bin/env python3
import asyncio
import argparse
import sys
import re
import os
import base64
import requests
from datetime import datetime
from dotenv import load_dotenv

# Define color codes for output
class bcolors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

# --- Log Parsing and Merging ---

def parse_log_timestamp(line):
    """Extracts timestamp from a log line."""
    # Laravel log format: [YYYY-MM-DD HH:MM:SS]
    match = re.match(r'\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]', line)
    if match:
        return datetime.strptime(match.group(1), '%Y-%m-%d %H:%M:%S')
    return None

async def stream_process(process, tag, color, log_queue):
    """Reads stdout of a process line by line and puts it into a queue."""
    while True:
        line_bytes = await process.stdout.readline()
        if not line_bytes:
            break
        line = line_bytes.decode('utf-8').strip()
        await log_queue.put({'source': tag, 'color': color, 'line': line, 'timestamp': datetime.now()})
    await process.wait()

async def stream_file(file_path, tag, color, log_queue, start_time):
    """Tails a file, ignoring old lines, and puts new lines into a queue."""
    try:
        with open(file_path, 'r') as f:
            # Go to the end of the file to ignore old content
            f.seek(0, 2)
            while True:
                line = f.readline()
                if not line:
                    await asyncio.sleep(0.1)
                    continue
                
                timestamp = parse_log_timestamp(line)
                if timestamp and timestamp >= start_time:
                    await log_queue.put({'source': tag, 'color': color, 'line': line.strip(), 'timestamp': timestamp})
                elif not timestamp: # For lines without timestamp (e.g., stack traces)
                    await log_queue.put({'source': tag, 'color': color, 'line': line.strip(), 'timestamp': datetime.now()})
    except FileNotFoundError:
        print(f"{bcolors.FAIL}Error: Log file not found at {file_path}{bcolors.ENDC}", file=sys.stderr)
        # Put a sentinel value to signal the main loop to stop
        await log_queue.put(None)

async def merge_logs(log_queue):
    """Pulls logs from the queue and prints them to the console."""
    last_screenshot_path = None
    annotated_screenshot_path = None
    
    # Variables to store WebSocket subscription info
    ws_report_data = {
        "channel": None,
        "events": set()
    }
    in_ws_report_block = False

    while True:
        log_item = await log_queue.get()
        if log_item is None:
            break
        
        timestamp_str = log_item['timestamp'].strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        
        line = log_item['line']

        # --- WebSocket Subscription Report Parsing ---
        if '--- 📡 WebSocket Subscription Report ---' in line:
            in_ws_report_block = True
            continue # Skip printing the header line itself
        if '--- END WebSocket Subscription Report ---' in line:
            in_ws_report_block = False
            continue # Skip printing the footer line
        
        if in_ws_report_block:
            channel_match = re.search(r'\[CHANNEL\]: (.*)', line)
            event_match = re.search(r'\[EVENT\]: (.*)', line)
            if channel_match:
                ws_report_data["channel"] = channel_match.group(1).strip()
            if event_match:
                ws_report_data["events"].add(event_match.group(1).strip())
            continue # Don't print these lines, just parse them

        print(f"{log_item['color']}[{timestamp_str}][{log_item['source'].ljust(8)}] {line}{bcolors.ENDC}")
        
        # Capture the screenshot paths from specific log messages
        match = re.search(r'✅ Screenshot saved to: (.*)', line)
        if not match:
            match = re.search(r'✅ Annotated screenshot \(DevTools style\) saved to: (.*)', line)

        if match:
            path = match.group(1).strip()
            if '.annotated.' in path:
                annotated_screenshot_path = path
            else:
                last_screenshot_path = path
        
        # If the queue is empty, yield control to allow other tasks to run
        if log_queue.empty():
            await asyncio.sleep(0.01)
            
    return last_screenshot_path, annotated_screenshot_path, ws_report_data

# --- Gemini Code Generation & Vision Analysis ---

def generate_playwright_code_with_gemini(instructions):
    """Generates Playwright JS code from natural language instructions using Gemini."""
    api_key = os.getenv("GEMINI_API_KEY")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    if not api_key:
        print(f"{bcolors.FAIL}Error: GEMINI_API_KEY environment variable not set.{bcolors.ENDC}", file=sys.stderr)
        return None

    print(f"{bcolors.OKCYAN}🤖 Generating Playwright actions with Gemini...{bcolors.ENDC}")

    try:
        headers = {"Content-Type": "application/json"}
        
        prompt = (
            "You are an expert Playwright automation engineer. Your task is to write a self-contained JavaScript module "
            "that exports a single asynchronous default function. This function will receive one argument: the Playwright 'page' object. "
            "Inside this function, implement the user's instructions precisely. Use modern async/await syntax. "
            "Do not add any explanations, comments, or surrounding text; provide only the raw JavaScript code for the module.\n\n"
            "User Instructions: \""
            f"{instructions}"
            "\"\n\n"
            "Example of expected output format:\n"
            "export default async (page) => {\n"
            "  await page.locator('button#submit').click();\n"
            "  await page.waitForTimeout(5000);\n"
            "};"
        )

        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={api_key}"
 
        response = requests.post(url, headers=headers, json=payload, timeout=90)
        response.raise_for_status()
        
        result = response.json()
        
        if 'candidates' in result and result['candidates']:
            code = result['candidates'][0]['content']['parts'][0]['text']
            # Clean the code from markdown fences
            cleaned_code = re.sub(r'```(javascript|js)?', '', code)
            cleaned_code = cleaned_code.strip()
            return cleaned_code
        else:
            print(f"{bcolors.FAIL}Gemini API Error: No candidates returned. Full response: {result}{bcolors.ENDC}", file=sys.stderr)
            return None

    except requests.exceptions.RequestException as e:
        print(f"{bcolors.FAIL}Gemini API Request Error: {e}{bcolors.ENDC}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"{bcolors.FAIL}An unexpected error occurred during Gemini code generation: {e}{bcolors.ENDC}", file=sys.stderr)
        return None

def analyze_screenshot_with_gemini(screenshot_path):
    """Analyzes an image with Gemini and returns the description."""
    api_key = os.getenv("GEMINI_API_KEY")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    if not api_key:
        print(f"{bcolors.FAIL}Error: GEMINI_API_KEY environment variable not set.{bcolors.ENDC}", file=sys.stderr)
        return None

    if not os.path.exists(screenshot_path):
        print(f"{bcolors.FAIL}Error: Screenshot file not found at {screenshot_path}{bcolors.ENDC}", file=sys.stderr)
        return None

    print(f"{bcolors.OKCYAN}🖼️  Analyzing screenshot with Gemini Vision...{bcolors.ENDC}")

    try:
        with open(screenshot_path, "rb") as image_file:
            image_data = base64.b64encode(image_file.read()).decode('utf-8')

        headers = {
            "Content-Type": "application/json",
        }
        
        prompt = "Analyze the annotated screenshot. The image has overlays with CSS selectors on UI elements. For each key element you describe, YOU MUST include its CSS selector path visible in the overlay. Focus on the main content area, ignoring the header and footer. Describe what the central part of the page contains and list the key UI components with their corresponding CSS selectors."

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/png",
                                "data": image_data
                            }
                        }
                    ]
                }
            ]
        }
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={api_key}"
 
        response = requests.post(url, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        
        result = response.json()
        
        if 'candidates' in result and result['candidates']:
            text_response = result['candidates'][0]['content']['parts'][0]['text']
            return text_response
        else:
            # Handle cases where the API returns a response without candidates (e.g., safety blocks)
            print(f"{bcolors.FAIL}Gemini API Error: No candidates returned. Full response: {result}{bcolors.ENDC}", file=sys.stderr)
            return "Analysis failed: No content returned from the API."

    except requests.exceptions.RequestException as e:
        print(f"{bcolors.FAIL}Gemini API Request Error: {e}{bcolors.ENDC}", file=sys.stderr)
        return f"Analysis failed due to a network error: {e}"
    except Exception as e:
        print(f"{bcolors.FAIL}An unexpected error occurred during Gemini analysis: {e}{bcolors.ENDC}", file=sys.stderr)
        return f"Analysis failed due to an unexpected error: {e}"


# --- Main Execution ---

async def main():
    # Load environment variables from .env file
    load_dotenv()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    
    parser = argparse.ArgumentParser(
        description="Run Playwright debug script and merge its output with Laravel logs.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument('url', help="The URL to test.")
    parser.add_argument('--auth', action='store_true', help="Enable automatic authentication.")
    parser.add_argument('--verify-persistence', action='store_true', help="Verify session persistence after login.")
    parser.add_argument('--wss', action='store_true', help="Enable WebSocket communication logging.")
    parser.add_argument('--analyze-screenshot', action='store_true', help="Enable AI analysis of the final screenshot using Gemini.")
    parser.add_argument('--instructions', help="Natural language instructions for Gemini to generate Playwright actions.")
    parser.add_argument(
        '--laravel-log', 
        default=None,
        help="Path to the Laravel log file. If not specified, Laravel log monitoring will be skipped."
    )
    parser.add_argument(
        '--playwright-script',
        default='./host-debug-editor.mjs',
        help="Path to the Playwright script."
    )
    
    args = parser.parse_args()

    # --- Handle AI Instructions ---
    temp_actions_file = None
    if args.instructions:
        generated_code = generate_playwright_code_with_gemini(args.instructions)
        if generated_code:
            temp_actions_file = "temp-actions.mjs"
            with open(temp_actions_file, "w") as f:
                f.write(generated_code)
            print(f"{bcolors.OKGREEN}✅ AI-generated actions saved to {temp_actions_file}{bcolors.ENDC}")
            print(f"{bcolors.OKCYAN}Generated Code:\n---\n{generated_code}\n---{bcolors.ENDC}")
        else:
            print(f"{bcolors.FAIL}Could not generate Playwright code. Aborting.{bcolors.ENDC}", file=sys.stderr)
            sys.exit(1)

    # Truncate the log file before starting (only if Laravel log path is specified)
    laravel_log_enabled = args.laravel_log is not None
    if laravel_log_enabled:
        try:
            print(f"{bcolors.WARNING}Truncating Laravel log file: {args.laravel_log}{bcolors.ENDC}")
            with open(args.laravel_log, 'w') as f:
                pass
            print(f"{bcolors.OKGREEN}Log file truncated successfully.{bcolors.ENDC}")
        except FileNotFoundError:
            print(f"{bcolors.WARNING}Log file not found at {args.laravel_log}, will be created.{bcolors.ENDC}")
        except Exception as e:
            print(f"{bcolors.FAIL}Error truncating log file: {e}. Laravel log monitoring will be disabled.{bcolors.ENDC}", file=sys.stderr)
            laravel_log_enabled = False
    else:
        print(f"{bcolors.OKCYAN}Laravel log monitoring disabled (no --laravel-log path specified).{bcolors.ENDC}")
    
    # Build the command for the Playwright script
    command = ['node', args.playwright_script, args.url]
    if args.auth:
        command.append('--auth')
    if args.verify_persistence:
        command.append('--verify-persistence')
    if args.wss:
        command.append('--wss')
    if temp_actions_file:
        command.append(f'--run-actions-from={temp_actions_file}')
        
    print(f"{bcolors.HEADER}--- Starting Debug Session ---{bcolors.ENDC}")
    print(f"{bcolors.OKCYAN}Playwright command:{bcolors.ENDC} {' '.join(command)}")
    if laravel_log_enabled:
        print(f"{bcolors.OKCYAN}Tailing Laravel log:{bcolors.ENDC} {args.laravel_log}\n")
    else:
        print(f"{bcolors.OKCYAN}Laravel log monitoring:{bcolors.ENDC} Disabled\n")

    log_queue = asyncio.Queue()
    start_time = datetime.now()

    # Start the Playwright script
    playwright_process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT
    )

    # Create tasks for streaming logs and merging them
    playwright_task = asyncio.create_task(stream_process(playwright_process, 'FRONTEND', bcolors.OKGREEN, log_queue))
    
    # Only create Laravel task if Laravel log is enabled
    laravel_task = None
    if laravel_log_enabled:
        laravel_task = asyncio.create_task(stream_file(args.laravel_log, 'BACKEND', bcolors.OKBLUE, log_queue, start_time))
    
    merger_task = asyncio.create_task(merge_logs(log_queue))

    # Wait for the Playwright process to finish
    await playwright_process.wait()
    
    # Allow some time for remaining logs to be processed
    await asyncio.sleep(1) 
    
    # Stop the log streaming and merging tasks
    playwright_task.cancel()
    if laravel_task:
        laravel_task.cancel()
    
    # Put a sentinel value to stop the merger gracefully
    await log_queue.put(None) 
    last_screenshot_path, annotated_screenshot_path, ws_report_data = await merger_task

    print(f"\n{bcolors.HEADER}--- Debug Session Finished ---{bcolors.ENDC}")
    
    # --- WebSocket Subscription Final Report ---
    if ws_report_data["channel"] or ws_report_data["events"]:
        print(f"{bcolors.HEADER}--- 📡 WebSocket Frontend Subscription Details ---{bcolors.ENDC}")
        print(f"{bcolors.OKCYAN}Subscribed Channel:{bcolors.ENDC} {ws_report_data['channel'] or 'Not detected'}")
        if ws_report_data["events"]:
            print(f"{bcolors.OKCYAN}Listened-to Events:{bcolors.ENDC}")
            for event in sorted(list(ws_report_data["events"])):
                print(f"  - {event}")
        else:
            print(f"{bcolors.WARNING}No listened-to events were detected.{bcolors.ENDC}")
        print(f"{bcolors.HEADER}-------------------------------------------{bcolors.ENDC}")


    # --- Cleanup ---
    if temp_actions_file:
        try:
            os.remove(temp_actions_file)
            print(f"{bcolors.OKCYAN}🧹 AI-generated actions file cleaned up.{bcolors.ENDC}")
        except OSError as e:
            print(f"{bcolors.FAIL}Error cleaning up temporary actions file: {e}{bcolors.ENDC}", file=sys.stderr)

    # Always try to analyze screenshot if the flag is set and a path was captured
    if args.analyze_screenshot and annotated_screenshot_path:
        analysis_result = analyze_screenshot_with_gemini(annotated_screenshot_path)
        if analysis_result:
            print(f"{bcolors.HEADER}--- 🤖 Gemini Vision Analysis (with DOM Paths) ---{bcolors.ENDC}")
            print(f"{bcolors.OKGREEN}{analysis_result}{bcolors.ENDC}")
            print(f"{bcolors.HEADER}----------------------------------{bcolors.ENDC}")
        # Clean up the annotated screenshot
        try:
            os.remove(annotated_screenshot_path)
            print(f"{bcolors.OKCYAN}🧹 Annotated screenshot cleaned up.{bcolors.ENDC}")
        except OSError as e:
            print(f"{bcolors.FAIL}Error cleaning up annotated screenshot: {e}{bcolors.ENDC}", file=sys.stderr)

    if playwright_process.returncode != 0:
        print(f"{bcolors.FAIL}Playwright script exited with error code: {playwright_process.returncode}{bcolors.ENDC}")
    else:
        print(f"{bcolors.OKGREEN}Playwright script finished successfully.{bcolors.ENDC}")

if __name__ == "__main__":
    asyncio.run(main())