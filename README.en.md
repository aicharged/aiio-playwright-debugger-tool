# Playwright Debugger Tool

This tool automates web debugging sessions by combining Playwright for browser automation with AI capabilities (Gemini) for generating actions and analyzing screenshots. It also merges output from a Python orchestrator script with Laravel logs for a comprehensive debugging experience.

## Features

*   **Automated Web Debugging:** Navigate, authenticate, and interact with web applications using Playwright.
*   **AI-Powered Action Generation:** Generate Playwright JavaScript code from natural language instructions using the Gemini API.
*   **AI-Powered Screenshot Analysis:** Analyze annotated screenshots with Gemini Vision to identify UI elements and their CSS selectors.
*   **Log Merging:** Combines output from the Python orchestrator and Laravel logs for a unified view.
*   **WebSocket Logging:** Captures and reports WebSocket communication.
*   **Session Persistence Verification:** Checks if user sessions persist after login and hard refresh.
*   **Multi-Language Support:** Documentation available in English, Russian, and Czech.

## Setup and Dependencies

This tool is packaged as a Docker image. You need Docker installed on your system to run it.

### Prerequisites

*   **Docker:** Ensure Docker is installed and running.
*   **Gemini API Key:** Obtain an API key from Google AI Studio ([https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)).
*   **Local Test Results Directory:** Create a directory named `frontend/test-results` in your project root (or adjust the volume mapping in `docker-compose.yml`) to store screenshots.

### Project Structure

The tool's files are located in:
`/docker/frontend/dev-aiio-platform-oleg/docker/tools/playwright-debugger/`

This directory contains:
*   `Dockerfile`: Instructions for building the Docker image.
*   `docker-compose.yml`: Defines the Docker service for running the tool.
*   `.env.example`: Example environment variables for configuration.
*   `requirements.txt`: Python dependencies.
*   `package.json`: Node.js dependencies.
*   `run-debug-session.py`: Python script orchestrating the debugging session.
*   `host-debug-editor.mjs`: Node.js script using Playwright for browser interaction.

## Configuration

1.  **Create `.env` file:**
    Copy the `.env.example` file to `.env` in the tool's directory:
    ```bash
    cp .env.example .env
    ```
2.  **Edit `.env`:**
    Open the `.env` file and update the following:
    *   `GEMINI_API_KEY`: Your actual Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
    *   `GEMINI_MODEL`: (Optional) The Gemini model to use (defaults to `gemini-2.5-flash-lite`).
    *   `AUTH_EMAIL`: (Optional) Default email for authentication.
    *   `AUTH_PASSWORD`: (Optional) Default password for authentication.
3.  **Laravel Log Integration (Optional):**
    If you want to monitor Laravel logs during debugging:
    *   Uncomment the Laravel log volume mount in `docker-compose.yml`
    *   Update the path to point to your actual Laravel log file
    *   Use the `--laravel-log` parameter when running the tool

## Usage

### Building the Docker Image

Navigate to the tool's directory and run:
```bash
docker build -t playwright-debugger .
```

### Running the Debugger

Use `docker-compose run` to execute the tool. You need to provide the target URL and any desired flags.

**Basic command (without Laravel log monitoring):**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>"
```

**With authentication and screenshot analysis:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>" --auth --analyze-screenshot
```

**With AI-generated instructions:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>" --instructions "Your natural language instructions here"
```

**With Laravel log monitoring:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>" --auth --laravel-log "/path/to/laravel.log"
```

**Complete example:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "https://example.com" --auth --analyze-screenshot --instructions "Click the login button and wait 3 seconds"
```

### Available Parameters

*   `<TARGET_URL>`: The URL to test (required)
*   `--auth`: Enable automatic authentication using credentials from .env
*   `--analyze-screenshot`: Enable AI analysis of the final screenshot using Gemini Vision
*   `--instructions "text"`: Natural language instructions for AI to generate Playwright actions
*   `--laravel-log "/path/to/log"`: Path to Laravel log file for monitoring (optional)
*   `--wss`: Enable WebSocket communication logging
*   `--verify-persistence`: Verify session persistence after login

**Important Notes:**
*   The `--rm` flag ensures the container is removed after execution
*   Screenshots are saved to `./data/test-results/` directory
*   Scripts are mounted from the local filesystem for live editing
*   `GEMINI_API_KEY` is required for AI features and must be set in `.env`