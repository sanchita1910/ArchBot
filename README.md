# ArchBot
ArchBot is a lightweight, three-tier LLM portal powered by Ollama. It provides:  ✓ Real-time streaming chat (SSE) ✓ Persistent sessions ✓ Session-level system prompts ✓ Intelligent SHA-256 caching with TTL ✓ Admin dashboard for monitoring ✓ Dockerized deployment (Frontend + Backend + Ollama)

## Architecture
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │    Backend      │     │     Ollama      │
│    (NGINX)      │◄────┤   (Node.js)     │◄────┤   (Llama 3.2)   │
│   Port: 3000    │     │   Port: 3001    │     │   Port: 11434   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```
## Architectural Patterns

Repository Pattern — Abstracted session + cache access
Adapter Pattern — Model-agnostic integration layer
Middleware Pattern — Logging, rate limiting, auth, error handling
Cache-Aside Pattern — SHA-256 keys + TTL
Service Layer — Encapsulated business logic

## Quick Start
1️⃣ Start All Services
docker compose up -d --build

2️⃣ Pull the Required LLM Model
docker exec -it ollama ollama pull llama3.2

🌐 Access the Application
Component	URL
Chat Portal	http://localhost:3000

Admin Dashboard	http://localhost:3000/admin.html

Default Admin Credentials

Username: admin

Password: csci578

🛑 Stop All Services
docker compose down

## Project Structure
pocketllm/
├── backend/
│   ├── server.js              # Express backend (SSE + caching)
│   ├── Dockerfile             # Backend container
│   ├── package.json
│
├── frontend/
│   ├── index.html             # Chat interface
│   ├── admin.html             # Admin dashboard
│   ├── Dockerfile             # NGINX container
│
├── docker-compose.yml         # Service orchestration
└── README.md

## Container Services
1. Ollama (ollama)

Image: ollama/ollama:latest

Port: 11434

Purpose: Runs the Llama 3.2 LLM

2. Backend (pocketllm-backend)

Base Image: node:18-alpine

Port: 3001

Environment:

OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=llama3.2
CACHE_TTL_MS=600000
PORT=3001

3. Frontend (pocketllm-frontend)

Base Image: nginx:alpine

Port: 3000

Purpose: Serves static HTML/CSS/JS
