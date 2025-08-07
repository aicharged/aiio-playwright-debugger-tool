# Use a base image with Node.js and Python pre-installed
# Using a specific Node version and a Debian-based image for broader compatibility
FROM node:20-bookworm-slim AS builder

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    && pip install --no-cache-dir --break-system-packages -r requirements.txt \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Node.js dependencies and Playwright browsers
COPY package*.json ./
RUN npm install --omit=dev && npm run install-playwright

# Copy the scripts into the container
COPY run-debug-session.py .
COPY host-debug-editor.mjs .

# Create directories for screenshots and results
RUN mkdir -p /app/frontend/test-results

# Set environment variables
# GEMINI_API_KEY should be provided at runtime
ENV GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
# Set Playwright browsers path to be accessible within the container
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

# The command to run the Python script, which orchestrates the Node.js script.
# Arguments will be passed when running the container.
CMD ["python3", "run-debug-session.py"]