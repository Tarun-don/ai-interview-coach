# AI Interview Coach 🎙️🤖

An AI-powered technical interview preparation application. Choose a technical topic, pick a difficulty level (**Easy**, **Medium**, or **Hard**), and have an AI interviewer conduct an interactive mock interview with questions one at a time, automatic wrap-up detection, and a scored final report with Pass/Fail.

---

## 📁 Project Structure

```text
AI_Interview_Coach/
├── backend/
│   ├── .venv/                 # Python virtual environment (pre-installed)
│   ├── .env                   # Environment variables (Add your GROQ_API_KEY here)
│   ├── .env.example           # Example environment template
│   ├── main.py                # FastAPI server entry point
│   └── requirements.txt       # Python dependencies (fastapi, uvicorn, groq, etc.)
├── frontend/
│   ├── src/                   # Next.js App Router source files
│   │   └── app/
│   │       ├── layout.tsx
│   │       ├── page.tsx       # AI Interview Coach landing page
│   │       └── globals.css
│   ├── package.json           # Frontend dependencies
│   └── tsconfig.json          # TypeScript config
└── README.md
```

---

## 🔑 1. Groq API Key Setup

1. Open `backend/.env`.
2. Replace `your_groq_api_key_here` with your actual Groq API key:
   ```env
   GROQ_API_KEY=gsk_your_actual_groq_key_here
   PORT=8000
   HOST=0.0.0.0
   ```
   *(Get your free API key at [console.groq.com/keys](https://console.groq.com/keys))*

---

## 🚀 2. How to Start the Project

Open **two separate terminal windows** (PowerShell or Bash) in `D:\Scaler\vibe_coding\AI_Interview_Coach`:

### Terminal 1: Backend (FastAPI)
```powershell
cd D:\Scaler\vibe_coding\AI_Interview_Coach\backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000
```
> Or directly run without activating:
> ```powershell
> cd D:\Scaler\vibe_coding\AI_Interview_Coach\backend
> .\.venv\Scripts\uvicorn.exe main:app --reload --port 8000
> ```
* Backend API: `http://localhost:8000`
* Interactive API Docs (Swagger UI): `http://localhost:8000/docs`

---

### Terminal 2: Frontend (Next.js)
```powershell
cd D:\Scaler\vibe_coding\AI_Interview_Coach\frontend
npm run dev
```
* Frontend Web App: `http://localhost:3000`

---

## 🔌 3. API Endpoints & Actions

### 🩺 Health Check: `GET /health` (or `GET /api/health`)
- **Response**:
  ```json
  {
    "status": "ok",
    "message": "AI Interview Coach API is running!",
    "groq_configured": true
  }
  ```

---

### 🎬 Action 1: Start Interview (`POST /api/interview/start`)
Sends topic and difficulty, returns the interviewer's first question.
- **Payload**:
  ```json
  {
    "topic": "System Design",
    "difficulty": "Hard"
  }
  ```
- **Response**:
  ```json
  {
    "message": "Welcome! Let's begin. How would you design a distributed cache system like Redis?",
    "is_completed": false
  }
  ```

---

### 💬 Action 2: Submit Answer (`POST /api/interview/answer`)
Sends the conversation history and the candidate's latest answer. Returns the next interviewer response and whether the interview has finished.
- **Payload**:
  ```json
  {
    "topic": "System Design",
    "difficulty": "Hard",
    "history": [
      { "role": "assistant", "content": "How would you design a distributed cache system?" }
    ],
    "answer": "I would use consistent hashing to distribute keys across nodes and replication for fault tolerance."
  }
  ```
- **Response**:
  ```json
  {
    "message": "Good point on consistent hashing. What strategy would you use to handle node failures and rebalancing?",
    "is_completed": false
  }
  ```
> *When the interview concludes, `is_completed` is returned as `true`.*

---

### 📊 Action 3: Generate Report (`POST /api/interview/report`)
Sends the completed interview transcript and receives the structured evaluation report.
- **Payload**:
  ```json
  {
    "topic": "System Design",
    "difficulty": "Hard",
    "history": [
      { "role": "assistant", "content": "..." },
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "..." }
    ]
  }
  ```
- **Response**:
  ```json
  {
    "score": 85,
    "strengths": [
      "Correctly suggested consistent hashing for key distribution"
    ],
    "weaknesses": [
      "Did not detail write-through vs write-back caching policies"
    ],
    "topics_to_revise": [
      "Cache eviction algorithms (LRU, LFU)",
      "Replication strategies (Raft, Gossip protocol)"
    ],
    "overall_verdict": "Demonstrated excellent grasp of distributed caching architecture.",
    "pass_fail": "Pass"
  }
  ```

---

## 🛠️ Stack & Libraries

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Python FastAPI, Uvicorn, Pydantic, Python-Dotenv
- **AI Engine**: Groq Cloud SDK (`groq`, default: `llama-3.3-70b-versatile` with automatic fallback to active models)

