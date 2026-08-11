FROM python:3.11-slim
WORKDIR /app
COPY app.py .
# reads creds from env (THUNDOC_BINANCE_KEY / THUNDOC_BINANCE_SECRET) or mounted testnet_keys.json
EXPOSE 8000
CMD ["python", "app.py"]
