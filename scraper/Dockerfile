# Playwright base image matches the pinned version in requirements.txt and
# ships the browsers + xvfb already.
FROM mcr.microsoft.com/playwright/python:v1.61.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY aisle_finder.py server.py ./

EXPOSE 8044

# Headful under xvfb is mandatory: Akamai blocks headless Chromium.
CMD ["xvfb-run", "-a", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8044"]
