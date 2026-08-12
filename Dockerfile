# Root Dockerfile for Render (build context = repo root).
# The app lives in ./backend.
FROM python:3.11-slim
WORKDIR /app
COPY backend/app.py .
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8000
CMD ["python", "app.py"]
