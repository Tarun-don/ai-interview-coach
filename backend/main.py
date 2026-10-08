import os
import logging
from contextlib import asynccontextmanager
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv
from groq import Groq, GroqError

from ai_service import generate_next_interviewer_turn, generate_interview_report

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ai_interview_coach")

# Load environment variables
load_dotenv()


# Lifespan: Prints friendly startup banner when server launches
@asynccontextmanager
async def lifespan(app: FastAPI):
    port = os.getenv("PORT", "8000")
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    is_groq_set = bool(api_key and api_key != "your_groq_api_key_here")
    model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    print("\n" + "=" * 62)
    print("🚀  AI Interview Coach - FastAPI Backend Server")
    print("=" * 62)
    print(f"📡  API Base URL    : http://localhost:{port}")
    print(f"📚  Interactive Docs: http://localhost:{port}/docs")
    print(f"🩺  Health Check    : http://localhost:{port}/health")
    print(f"🤖  AI Provider     : Groq Cloud ({model})")
    print(f"🔑  API Key Status  : {'Configured ✓' if is_groq_set else 'Missing ✗ (Set in backend/.env)'}")
    print(f"🌐  CORS Enabled    : Any localhost / 127.0.0.1 port")
    print("=" * 62 + "\n")
    yield
    print("\n🛑  AI Interview Coach Backend stopped.\n")


app = FastAPI(
    title="AI Interview Coach API",
    description="Backend API for AI Interview Coach: Start interview, submit answers, and generate evaluation reports",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for localhost frontend on any port
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_groq_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key or api_key == "your_groq_api_key_here":
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not configured. Please set a valid key in backend/.env",
        )
    return Groq(api_key=api_key)


# --- Custom Exception Handlers for Friendly Error Messages ---

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Formats validation errors into clean, friendly user-facing messages."""
    error_messages = []
    for err in exc.errors():
        loc = [str(x) for x in err.get("loc", []) if x != "body"]
        field_name = " -> ".join(loc) if loc else "input"
        msg = err.get("msg", "Invalid value")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        error_messages.append(f"{field_name}: {msg}" if loc else msg)

    friendly_detail = "; ".join(error_messages) or "Invalid input data provided."
    logger.warning(f"Validation error on {request.url.path}: {friendly_detail}")
    return JSONResponse(
        status_code=400,
        content={"detail": friendly_detail},
    )


@app.exception_handler(GroqError)
async def groq_exception_handler(request: Request, exc: GroqError):
    """Catches Groq API errors and returns friendly diagnostic messages."""
    err_str = str(exc)
    logger.error(f"Groq API error on {request.url.path}: {err_str}")

    if "api_key" in err_str.lower() or "401" in err_str:
        friendly = "Invalid Groq API key. Please check GROQ_API_KEY in backend/.env"
    elif "rate_limit" in err_str.lower() or "429" in err_str:
        friendly = "Groq rate limit reached. Please wait a few moments and try again."
    else:
        friendly = f"AI service error from Groq: {err_str}"

    return JSONResponse(status_code=502, content={"detail": friendly})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all to prevent unhandled crashes and return a clean JSON response."""
    logger.error(f"Unhandled error on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"An unexpected server error occurred: {str(exc)}"},
    )


# --- Validated Request & Response Schemas ---

class HealthResponse(BaseModel):
    status: str
    message: str
    groq_configured: bool


class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str

    @field_validator("content")
    @classmethod
    def clean_content(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Message content cannot be blank.")
        return cleaned


# Action 1: Start Interview
class InterviewStartRequest(BaseModel):
    topic: str = Field(..., description="Technical topic to interview on")
    difficulty: str = Field(..., description="Difficulty: Easy, Medium, or Hard")

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Please provide a technical topic.")
        if len(cleaned) < 2:
            raise ValueError("Topic must be at least 2 characters long.")
        if len(cleaned) > 200:
            raise ValueError("Topic cannot exceed 200 characters.")
        return cleaned

    @field_validator("difficulty", mode="before")
    @classmethod
    def validate_difficulty(cls, v: str) -> str:
        if not isinstance(v, str):
            raise ValueError("Difficulty must be a text value: Easy, Medium, or Hard.")
        normalized = v.strip().capitalize()
        if normalized not in ("Easy", "Medium", "Hard"):
            raise ValueError("Difficulty must be one of: Easy, Medium, or Hard.")
        return normalized


# Action 2: Submit Answer
class AnswerSubmitRequest(BaseModel):
    topic: str
    difficulty: str
    history: List[Message] = Field(default=[], description="Conversation history so far")
    answer: str = Field(..., description="Candidate's submitted answer")

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Please provide a technical topic.")
        return cleaned

    @field_validator("difficulty", mode="before")
    @classmethod
    def validate_difficulty(cls, v: str) -> str:
        normalized = str(v).strip().capitalize()
        if normalized not in ("Easy", "Medium", "Hard"):
            raise ValueError("Difficulty must be one of: Easy, Medium, or Hard.")
        return normalized

    @field_validator("answer")
    @classmethod
    def validate_answer(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Your answer cannot be blank.")
        if len(cleaned) > 10000:
            raise ValueError("Answer exceeds maximum length of 10,000 characters.")
        return cleaned

    @field_validator("history")
    @classmethod
    def limit_history(cls, v: List[Message]) -> List[Message]:
        # Guard against context overflows by preserving up to 50 most recent turns
        return v[-50:] if len(v) > 50 else v


# Response for interview turns
class InterviewTurnResponse(BaseModel):
    message: str = Field(..., description="Interviewer statement or question")
    is_completed: bool = Field(..., description="True if the interviewer has ended the interview")


# Action 3: Generate Report
class ReportGenerateRequest(BaseModel):
    topic: str
    difficulty: str
    history: List[Message] = Field(..., description="Complete interview transcript")

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Please provide a technical topic.")
        return cleaned

    @field_validator("difficulty", mode="before")
    @classmethod
    def validate_difficulty(cls, v: str) -> str:
        normalized = str(v).strip().capitalize()
        if normalized not in ("Easy", "Medium", "Hard"):
            raise ValueError("Difficulty must be one of: Easy, Medium, or Hard.")
        return normalized

    @field_validator("history")
    @classmethod
    def validate_report_history(cls, v: List[Message]) -> List[Message]:
        if not v:
            raise ValueError("At least one conversation turn is required to generate a report.")
        has_user_answer = any(m.role == "user" and m.content.strip() for m in v)
        if not has_user_answer:
            raise ValueError("Conversation must include at least one response from the candidate.")
        return v[-50:] if len(v) > 50 else v


class ReportResponse(BaseModel):
    score: int = Field(..., ge=0, le=100, description="Overall score between 0 and 100")
    strengths: List[str] = Field(..., description="Strengths referring directly to candidate statements")
    weaknesses: List[str] = Field(..., description="Weaknesses referring directly to candidate statements")
    topics_to_revise: List[str] = Field(..., description="Specific topics candidate should revise")
    overall_verdict: str = Field(..., description="2-4 sentence summary of performance")
    pass_fail: Literal["Pass", "Fail"] = Field(..., description="'Pass' or 'Fail'")


# --- Health Check Endpoints ---

@app.get("/", response_model=HealthResponse)
def root():
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    is_groq_set = bool(api_key and api_key != "your_groq_api_key_here")
    return HealthResponse(
        status="ok",
        message="AI Interview Coach API is running!",
        groq_configured=is_groq_set,
    )


@app.get("/health", response_model=HealthResponse)
@app.get("/api/health", response_model=HealthResponse)
def health_check():
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    is_groq_set = bool(api_key and api_key != "your_groq_api_key_here")
    return HealthResponse(
        status="ok",
        message="AI Interview Coach API is running!",
        groq_configured=is_groq_set,
    )


# --- Action 1: Start Interview ---

@app.post("/api/interview/start", response_model=InterviewTurnResponse)
def start_interview(payload: InterviewStartRequest):
    """Action 1: Start an interview. Returns interviewer's first question."""
    client = get_groq_client()
    try:
        result = generate_next_interviewer_turn(
            client=client,
            topic=payload.topic,
            difficulty=payload.difficulty,
            history=[],
        )
        return InterviewTurnResponse(**result)
    except GroqError:
        raise
    except Exception as e:
        logger.error(f"Error starting interview: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate first interview question: {str(e)}",
        )


# --- Action 2: Submit Answer ---

@app.post("/api/interview/answer", response_model=InterviewTurnResponse)
def submit_answer(payload: AnswerSubmitRequest):
    """Action 2: Submit an answer. Returns next turn and completion status."""
    client = get_groq_client()
    try:
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in payload.history]

        # Append candidate's answer if not already the last turn
        if not (history_dicts and history_dicts[-1]["role"] == "user" and history_dicts[-1]["content"] == payload.answer):
            history_dicts.append({"role": "user", "content": payload.answer})

        result = generate_next_interviewer_turn(
            client=client,
            topic=payload.topic,
            difficulty=payload.difficulty,
            history=history_dicts,
        )
        return InterviewTurnResponse(**result)
    except GroqError:
        raise
    except Exception as e:
        logger.error(f"Error evaluating answer: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to evaluate answer: {str(e)}",
        )


# --- Action 3: Generate Report ---

@app.post("/api/interview/report", response_model=ReportResponse)
def create_interview_report(payload: ReportGenerateRequest):
    """Action 3: Generate structured report with score, strengths, weaknesses, and verdict."""
    client = get_groq_client()
    try:
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in payload.history]
        report_data = generate_interview_report(
            client=client,
            topic=payload.topic,
            difficulty=payload.difficulty,
            history=history_dicts,
        )
        return ReportResponse(**report_data)
    except GroqError:
        raise
    except Exception as e:
        logger.error(f"Error generating report: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate evaluation report: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)
