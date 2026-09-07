FROM python:3.11-slim

WORKDIR /app

# cryptg butuh compiler saat build wheel
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 7860

# HF Spaces Docker wajib pakai user non-root
RUN useradd -m -u 1000 botuser && chown -R botuser:botuser /app
USER botuser

CMD ["python", "-u", "runner.py"]
