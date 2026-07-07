# MyLisa Web

Set the frontend API connection in a local `.env` file:

```bash
VITE_API_BASE=http://localhost:4010
VITE_API_KEY=replace-with-your-mylisa-api-key
```

The web client sends `VITE_API_KEY` as an `x-api-key` header on every API request.
