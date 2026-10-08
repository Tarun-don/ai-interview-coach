import json
import logging
import os
import re
from typing import List, Dict, Any
from groq import Groq, NotFoundError, BadRequestError

logger = logging.getLogger(__name__)

# Primary requested model
PRIMARY_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
# Fallback models in case the requested model is decommissioned or unavailable on the account
FALLBACK_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]

INTERVIEWER_SYSTEM_PROMPT = """You are an expert technical interviewer conducting a live, structured technical interview.
You are interviewing a candidate on the topic: '{topic}' at '{difficulty}' difficulty.

DIFFICULTY GUIDELINES:
- Easy: Focus on basic definitions, fundamental recall, and core terms.
- Medium: Focus on applied problems, practical implementation, and common pitfalls.
- Hard: Focus on architectural trade-offs, scalability, edge cases, and deep system thinking.

INTERVIEW RULES:
1. Ask exactly ONE question at a time.
2. If this is the start of the interview (no prior questions from you):
   - Welcome the candidate briefly in 1 warm sentence.
   - Ask the first question appropriate for the '{difficulty}' difficulty level.
3. If reviewing the candidate's previous response:
   - If the answer is strong: Acknowledge briefly (e.g., "Good point." or "That's solid.") and transition to a DIFFERENT aspect of the topic.
   - If the answer is partly right: Ask exactly ONE focused probing follow-up without revealing the answer.
   - If the answer is wrong: Note the gap in one concise, neutral line (e.g., "Keep in mind that X actually behaves like Y under load.") and move on to another aspect.
4. STRICT GUARDRAILS:
   - NEVER teach the concept or lecture.
   - NEVER give hints or suggest solutions.
   - Stay professional, concise, and encouraging.
5. WRAPPING UP / ENDING:
   - If the candidate is clearly struggling across multiple questions (e.g. failing to answer 2-3 questions reasonably), kindly and respectfully end the interview early.
   - If the candidate is doing very well, wrap up the interview once the key foundational and advanced areas are covered (typically after 4 to 6 total questions).
   - When wrapping up, thank the candidate for their time and state that the interview is complete and their evaluation report is being prepared.
   - Set "is_completed" to true when the interview has ended, and false if another question is being asked.

OUTPUT FORMAT:
You MUST respond with a valid JSON object with EXACTLY this structure:
{
  "message": "<The exact response and/or question to the candidate>",
  "is_completed": true or false
}
"""

REPORT_SYSTEM_PROMPT = """You are a rigorous, fair technical interview evaluator analyzing a candidate's complete interview transcript.
Topic: '{topic}'
Difficulty: '{difficulty}'

SCORING CRITERIA:
- 85 to 100: Excellent (Demonstrated deep understanding, accurate details, and clear articulation)
- 70 to 84: Good (Solid competency, answered majority correctly with minor gaps)
- 55 to 69: Adequate (Basic understanding present, but noticeable gaps or struggled on follow-ups)
- Below 55: Weak (Struggled with core concepts, incorrect explanations, or unable to answer)

VERDICT & PASS/FAIL:
- "Pass": Candidates scoring 70 and above, demonstrating solid or excellent performance for this difficulty level.
- "Fail": Candidates scoring below 70, where fundamental or applied gaps were significant for the selected difficulty.

EVALUATION REQUIREMENTS:
1. Score (0 - 100): An integer score reflecting performance throughout the entire interview based on the criteria above.
2. Strengths: Specific list of points the candidate did well. MUST cite or directly refer to things the candidate actually said during the interview.
3. Weaknesses: Specific list of areas where the candidate was wrong, incomplete, or hesitated. MUST refer to specific claims, omissions, or answers the candidate actually made.
4. Topics to revise: Concrete list of topics, concepts, or tools the candidate should study to improve.
5. Overall verdict: A comprehensive 2-4 sentence summary of performance corresponding to their scoring tier (Excellent / Good / Adequate / Weak).
6. Pass or Fail: Exactly "Pass" or "Fail".

OUTPUT FORMAT:
You MUST respond with a valid JSON object with EXACTLY this structure:
{
  "score": <integer from 0 to 100>,
  "strengths": ["<strength 1 citing what candidate actually said>", ...],
  "weaknesses": ["<weakness 1 citing candidate statements or gaps>", ...],
  "topics_to_revise": ["<topic 1>", ...],
  "overall_verdict": "<2-4 sentence evaluation summary>",
  "pass_fail": "Pass" or "Fail"
}
"""


def _clean_and_parse_json(content: str) -> Dict[str, Any]:
    """Helper to parse JSON from LLM response, stripping markdown fences or preamble if present."""
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Extract outermost JSON object if model included preamble
        match = re.search(r"(\{[\s\S]*\})", content)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        logger.error(f"Failed to parse JSON from content: {content}")
        return {}


def _call_groq_with_fallback(
    client: Groq,
    messages: List[Dict[str, str]],
    temperature: float = 0.6,
) -> str:
    """
    Executes chat completion with Groq. Tries PRIMARY_MODEL first;
    falls back if model is not found or decommissioned.
    """
    models_to_try = [PRIMARY_MODEL] + [m for m in FALLBACK_MODELS if m != PRIMARY_MODEL]

    last_error = None
    for model in models_to_try:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content or "{}"
        except (NotFoundError, BadRequestError) as e:
            err_msg = str(e).lower()
            if "model_not_found" in err_msg or "decommissioned" in err_msg or "does not exist" in err_msg:
                logger.warning(f"Model {model} unavailable on Groq. Trying next fallback...")
                last_error = e
                continue
            raise e
        except Exception as e:
            raise e

    if last_error:
        raise last_error
    raise RuntimeError("No available Groq model succeeded.")


def generate_next_interviewer_turn(
    client: Groq,
    topic: str,
    difficulty: str,
    history: List[Dict[str, str]],
) -> Dict[str, Any]:
    """
    Calls Groq to get the next turn of the interview.
    Returns dict with {"message": str, "is_completed": bool}
    """
    sys_prompt = (
        INTERVIEWER_SYSTEM_PROMPT
        .replace("{topic}", topic)
        .replace("{difficulty}", difficulty)
    )

    messages = [{"role": "system", "content": sys_prompt}]

    # Append past conversation turns
    for turn in history:
        role = turn.get("role", "user")
        if role in ["user", "assistant"]:
            messages.append({"role": role, "content": turn.get("content", "")})

    # If history is empty, add a starting prompt
    if not history:
        messages.append({
            "role": "user",
            "content": f"I am ready to begin my {difficulty} technical interview on {topic}. Please ask the first question.",
        })

    raw_content = _call_groq_with_fallback(client, messages, temperature=0.6)
    data = _clean_and_parse_json(raw_content)

    return {
        "message": data.get("message", "Could you explain your thoughts on this topic?"),
        "is_completed": bool(data.get("is_completed", False)),
    }


def generate_interview_report(
    client: Groq,
    topic: str,
    difficulty: str,
    history: List[Dict[str, str]],
) -> Dict[str, Any]:
    """
    Calls Groq to generate a structured evaluation report.
    Returns:
      score: int (0 to 100)
      strengths: List[str]
      weaknesses: List[str]
      topics_to_revise: List[str]
      overall_verdict: str
      pass_fail: "Pass" | "Fail"
    """
    sys_prompt = (
        REPORT_SYSTEM_PROMPT
        .replace("{topic}", topic)
        .replace("{difficulty}", difficulty)
    )

    # Format transcript for review
    transcript_lines = []
    for turn in history:
        role_label = "Interviewer" if turn.get("role") == "assistant" else "Candidate"
        transcript_lines.append(f"{role_label}: {turn.get('content', '')}")

    transcript_text = "\n\n".join(transcript_lines)

    messages = [
        {"role": "system", "content": sys_prompt},
        {
            "role": "user",
            "content": (
                f"Here is the complete interview transcript on topic '{topic}' ({difficulty} difficulty):\n\n"
                f"{transcript_text}\n\n"
                "Please analyze this conversation and generate the structured performance report according to the criteria."
            ),
        },
    ]

    raw_content = _call_groq_with_fallback(client, messages, temperature=0.3)
    data = _clean_and_parse_json(raw_content)

    score = int(data.get("score", 50))
    score = max(0, min(100, score))

    pass_fail = data.get("pass_fail", "Pass" if score >= 70 else "Fail")
    if pass_fail not in ["Pass", "Fail"]:
        pass_fail = "Pass" if score >= 70 else "Fail"

    return {
        "score": score,
        "strengths": data.get("strengths", []),
        "weaknesses": data.get("weaknesses", []),
        "topics_to_revise": data.get("topics_to_revise", []),
        "overall_verdict": data.get("overall_verdict", "Interview completed."),
        "pass_fail": pass_fail,
    }

