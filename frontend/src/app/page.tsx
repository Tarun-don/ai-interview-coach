"use client";

import { useState, useEffect, useRef } from "react";

type Difficulty = "Easy" | "Medium" | "Hard";
type Screen = "setup" | "interview" | "report";

interface Message {
  role: "assistant" | "user" | "system";
  content: string;
  timestamp?: string;
  questionNumber?: number;
}

interface ReportData {
  score: number;
  strengths: string[];
  weaknesses: string[];
  topics_to_revise: string[];
  overall_verdict: string;
  pass_fail: "Pass" | "Fail";
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const POPULAR_TOPICS = [
  "Python Concurrency",
  "System Design",
  "React Internals & Hooks",
  "SQL & Query Optimization",
  "Docker & Kubernetes",
  "Data Structures & Algorithms",
];

const DIFFICULTY_CONFIG: Record<
  Difficulty,
  { label: string; desc: string; badgeColor: string; activeBorder: string }
> = {
  Easy: {
    label: "Easy",
    desc: "Basic definitions, terminology, and core recall",
    badgeColor: "text-emerald-400 bg-emerald-950/60 border-emerald-800/80",
    activeBorder: "border-emerald-500 bg-emerald-950/20 text-emerald-200",
  },
  Medium: {
    label: "Medium",
    desc: "Applied problems, scenarios, and real-world implementation",
    badgeColor: "text-amber-400 bg-amber-950/60 border-amber-800/80",
    activeBorder: "border-amber-500 bg-amber-950/20 text-amber-200",
  },
  Hard: {
    label: "Hard",
    desc: "System thinking, architectural trade-offs, and scalability",
    badgeColor: "text-rose-400 bg-rose-950/60 border-rose-800/80",
    activeBorder: "border-rose-500 bg-rose-950/20 text-rose-200",
  },
};

export default function Home() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Health status
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [groqConfigured, setGroqConfigured] = useState<boolean | null>(null);

  // Interview state
  const [conversation, setConversation] = useState<Message[]>([]);
  const [candidateAnswer, setCandidateAnswer] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  // Report state
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [copiedNotification, setCopiedNotification] = useState(false);

  // Refs for scrolling & focusing
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Helper: Count assistant questions
  const totalQuestionsAsked = conversation.filter((m) => m.role === "assistant").length;

  // Check health on load
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/health`)
      .then((res) => {
        if (!res.ok) throw new Error("Status " + res.status);
        return res.json();
      })
      .then((data) => {
        setBackendStatus("online");
        setGroqConfigured(Boolean(data.groq_configured));
      })
      .catch(() => {
        setBackendStatus("offline");
      });
  }, []);

  // Auto-scroll when conversation or thinking state updates
  useEffect(() => {
    if (screen === "interview") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [conversation, isThinking, screen]);

  // Focus textarea when thinking finishes
  useEffect(() => {
    if (screen === "interview" && !isThinking) {
      textareaRef.current?.focus();
    }
  }, [isThinking, screen]);

  // Format current time
  const getTimeString = () => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Helper for Score Tier & Styling
  const getScoreTier = (score: number) => {
    if (score >= 70) {
      return {
        label: "Good",
        textColor: "text-emerald-400",
        badgeBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
        boxBorder: "border-emerald-600/70",
        boxBg: "bg-emerald-950/40",
        summaryText: "Solid to excellent technical understanding demonstrated.",
      };
    }
    if (score >= 55) {
      return {
        label: "Okay",
        textColor: "text-amber-400",
        badgeBg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
        boxBorder: "border-amber-600/70",
        boxBg: "bg-amber-950/40",
        summaryText: "Adequate foundational knowledge, but noticeable gaps were identified.",
      };
    }
    return {
      label: "Weak",
      textColor: "text-rose-400",
      badgeBg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
      boxBorder: "border-rose-600/70",
      boxBg: "bg-rose-950/40",
      summaryText: "Struggled with core concepts. Revision recommended before interviewing.",
    };
  };

  // 1. Action: Start Interview
  const handleStartInterview = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    const cleanTopic = topic.trim();
    if (!cleanTopic) {
      setErrorMessage("Please enter a technical topic before starting.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/interview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: cleanTopic,
          difficulty,
        }),
      });

      if (!response.ok) {
        let errorDetail = "Failed to start interview.";
        try {
          const errorJson = await response.json();
          if (errorJson.detail) errorDetail = errorJson.detail;
        } catch {
          errorDetail = `Server responded with HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorDetail);
      }

      const data = await response.json();

      setConversation([
        {
          role: "assistant",
          content: data.message,
          timestamp: getTimeString(),
          questionNumber: 1,
        },
      ]);
      setScreen("interview");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not connect to the backend server. Make sure FastAPI is running on port 8000.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Action: Submit Candidate Answer
  const handleSendAnswer = async () => {
    const text = candidateAnswer.trim();
    if (!text || isThinking) return;

    // Append user message immediately
    const userMessage: Message = {
      role: "user",
      content: text,
      timestamp: getTimeString(),
    };
    const updatedHistory: Message[] = [...conversation, userMessage];

    setConversation(updatedHistory);
    setCandidateAnswer("");
    setIsThinking(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/interview/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          difficulty,
          history: updatedHistory.map((m) => ({ role: m.role, content: m.content })),
          answer: text,
        }),
      });

      if (!res.ok) {
        let errDesc = "Failed to submit answer.";
        try {
          const errData = await res.json();
          if (errData.detail) errDesc = errData.detail;
        } catch {
          errDesc = `Server error ${res.status}`;
        }
        throw new Error(errDesc);
      }

      const data = await res.json();

      const assistantCount = updatedHistory.filter((m) => m.role === "assistant").length;

      const assistantMessage: Message = {
        role: "assistant",
        content: data.message,
        timestamp: getTimeString(),
        questionNumber: assistantCount + 1,
      };

      const finalHistory: Message[] = [...updatedHistory, assistantMessage];
      setConversation(finalHistory);

      // If the interviewer completed the interview, transition to the report screen automatically
      if (data.is_completed) {
        setIsThinking(false);
        await fetchReport(finalHistory);
        return;
      }
    } catch (err: unknown) {
      // Restore candidate answer into textarea so their typed response is not lost
      setCandidateAnswer(text);
      // Remove the optimistic user turn from conversation
      setConversation(conversation);
      alert(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while communicating with the AI interviewer."
      );
    } finally {
      setIsThinking(false);
    }
  };

  // Key handler: Enter to send, Shift+Enter for new line
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendAnswer();
    }
  };

  // 3. Action: Generate Report
  const fetchReport = async (historyToEvaluate: Message[]) => {
    setScreen("report");
    setIsGeneratingReport(true);
    setReportError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/interview/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          difficulty,
          history: historyToEvaluate.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        let errDesc = "Failed to generate report.";
        try {
          const errData = await res.json();
          if (errData.detail) errDesc = errData.detail;
        } catch {
          errDesc = `Server error ${res.status}`;
        }
        throw new Error(errDesc);
      }

      const data: ReportData = await res.json();
      setReport(data);
    } catch (err: unknown) {
      setReportError(
        err instanceof Error ? err.message : "Error generating evaluation report."
      );
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Reset / Return to Setup (Start New Interview)
  const handleReset = () => {
    if (
      screen === "interview" &&
      conversation.length > 1 &&
      !window.confirm("Exit this interview? Your progress will be reset.")
    ) {
      return;
    }
    setScreen("setup");
    setConversation([]);
    setCandidateAnswer("");
    setReport(null);
    setErrorMessage(null);
    setReportError(null);
    setIsGeneratingReport(false);
  };

  // Copy report summary to clipboard
  const handleCopyReport = () => {
    if (!report) return;
    const text = `AI Interview Coach Report
Topic: ${topic} (${difficulty})
Score: ${report.score}/100 (${report.pass_fail})
Verdict: ${report.overall_verdict}

Strengths:
${report.strengths.map((s) => `- ${s}`).join("\n")}

Areas for Improvement:
${report.weaknesses.map((w) => `- ${w}`).join("\n")}

Topics to Revise:
${report.topics_to_revise.map((t) => `- ${t}`).join("\n")}`;

    navigator.clipboard.writeText(text);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2500);
  };

  return (
    <div
      suppressHydrationWarning
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-indigo-500 selection:text-white relative"
    >
      {/* Background radial glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[550px] bg-gradient-to-b from-indigo-500/10 via-purple-500/5 to-transparent blur-3xl -z-10" />

      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-2.5 text-left hover:opacity-90 transition-opacity cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-600/30">
                🎙️
              </div>
              <span className="font-semibold text-lg tracking-tight text-white">
                AI Interview Coach
              </span>
            </button>
          </div>

          {/* Header Controls for Interview & Report Screens */}
          {screen === "interview" ? (
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs">
                <span className="text-slate-400">Topic:</span>
                <span className="font-medium text-slate-200 truncate max-w-[150px]">{topic}</span>
                <span className="text-slate-600">•</span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    DIFFICULTY_CONFIG[difficulty].badgeColor
                  }`}
                >
                  {difficulty}
                </span>
              </div>

              {/* End & Get Report Early Option */}
              {conversation.length >= 3 && (
                <button
                  type="button"
                  onClick={() => fetchReport(conversation)}
                  disabled={isThinking}
                  className="text-xs px-3 py-1.5 rounded-lg border border-indigo-700/60 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 transition-colors cursor-pointer hidden md:inline-flex items-center gap-1.5"
                >
                  <span>Finish &amp; Get Report</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleReset}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                Exit
              </button>
            </div>
          ) : screen === "report" ? (
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={handleCopyReport}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span>{copiedNotification ? "✓ Copied!" : "📋 Copy Report"}</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors cursor-pointer"
              >
                Start New Interview
              </button>
            </div>
          ) : (
            /* Backend Status Indicator (Setup Screen) */
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  backendStatus === "online"
                    ? groqConfigured
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-amber-400"
                    : backendStatus === "checking"
                    ? "bg-slate-500 animate-ping"
                    : "bg-rose-500"
                }`}
              />
              <span className="text-xs text-slate-400 hidden sm:inline">
                {backendStatus === "online"
                  ? groqConfigured
                    ? "Groq Ready"
                    : "GROQ_API_KEY Missing"
                  : backendStatus === "checking"
                  ? "Connecting..."
                  : "Backend Offline"}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col min-h-0">
        {/* ============================================================
            SCREEN 1: SETUP SCREEN
            ============================================================ */}
        {screen === "setup" && (
          <div className="max-w-2xl mx-auto w-full my-auto py-6 sm:py-8 animate-in fade-in duration-200">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/70 border border-indigo-800/80 text-indigo-300 text-xs font-medium mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                Adaptive Technical Interviewer
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
                AI Interview Coach
              </h1>
              <p className="mt-3 text-slate-400 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
                Practice technical interviews one question at a time with realistic, adaptive AI questioning and instant performance feedback.
              </p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-indigo-950/30 backdrop-blur-sm">
              <form onSubmit={handleStartInterview} className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label
                      htmlFor="topic-input"
                      className="text-sm font-semibold text-slate-200"
                    >
                      Technical Topic
                    </label>
                    <span className="text-xs text-slate-500">Required</span>
                  </div>
                  <input
                    id="topic-input"
                    type="text"
                    value={topic}
                    onChange={(e) => {
                      setTopic(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    disabled={isLoading}
                    placeholder="e.g. System Design, Python Concurrency, React Hooks..."
                    className="w-full px-4 py-3.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                  />

                  {/* Suggestion Chips */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {POPULAR_TOPICS.map((suggested) => (
                      <button
                        key={suggested}
                        type="button"
                        onClick={() => {
                          setTopic(suggested);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        disabled={isLoading}
                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/70 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50 transition-colors cursor-pointer"
                      >
                        {suggested}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Difficulty Selector */}
                <div>
                  <label className="block text-sm font-semibold text-slate-200 mb-2">
                    Difficulty Level
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(["Easy", "Medium", "Hard"] as Difficulty[]).map((level) => {
                      const isSelected = difficulty === level;
                      const conf = DIFFICULTY_CONFIG[level];
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setDifficulty(level)}
                          disabled={isLoading}
                          className={`relative text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? `${conf.activeBorder} shadow-lg shadow-indigo-950/40 ring-1 ring-inset ring-white/10`
                              : "bg-slate-950/70 border-slate-800/90 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm">
                              {conf.label}
                            </span>
                            {isSelected && (
                              <span className="w-2 h-2 rounded-full bg-indigo-400" />
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-snug">
                            {conf.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Error Banner */}
                {errorMessage && (
                  <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-sm flex items-start gap-3">
                    <span className="text-rose-400 text-base leading-none">⚠️</span>
                    <div className="flex-1">
                      <p className="font-medium text-rose-200">{errorMessage}</p>
                      {errorMessage.includes("FastAPI") || errorMessage.includes("backend") ? (
                        <p className="text-xs text-rose-300/80 mt-1">
                          Run: <code className="bg-rose-900/40 px-1 py-0.5 rounded font-mono">cd backend &amp;&amp; .\.venv\Scripts\uvicorn.exe main:app --reload --port 8000</code>
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-4 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-semibold text-base transition-all shadow-xl shadow-indigo-600/25 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Starting Interview...</span>
                    </>
                  ) : (
                    <>
                      <span>Start Interview</span>
                      <span className="text-indigo-200">→</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-4 text-center text-xs text-slate-500">
              <div>🎯 One question at a time</div>
              <div>⚡ Dynamic adaptive follow-ups</div>
              <div>📈 Detailed Pass/Fail report</div>
            </div>
          </div>
        )}

        {/* ============================================================
            SCREEN 2: INTERVIEW CHAT SCREEN (Responsive Mobile & Desktop)
            ============================================================ */}
        {screen === "interview" && (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full h-[calc(100dvh-130px)] min-h-[450px]">
            {/* Top Session Subheader */}
            <div className="mb-3 p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between text-xs shadow-sm">
              <div className="flex items-center gap-2 truncate mr-2">
                <span className="font-semibold text-slate-200 truncate">
                  {topic}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border shrink-0 ${
                    DIFFICULTY_CONFIG[difficulty].badgeColor
                  }`}
                >
                  {difficulty}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-slate-400 font-mono">
                  {totalQuestionsAsked > 0 ? `Q${totalQuestionsAsked}` : "Intro"}
                </span>
                {/* Mobile Wrap Up Button */}
                {conversation.length >= 3 && (
                  <button
                    type="button"
                    onClick={() => fetchReport(conversation)}
                    disabled={isThinking}
                    className="text-[11px] px-2 py-1 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 md:hidden cursor-pointer"
                  >
                    Finish
                  </button>
                )}
              </div>
            </div>

            {/* Chat Messages Container */}
            <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-4 space-y-4 rounded-2xl bg-slate-900/40 border border-slate-800/80 mb-3 shadow-inner">
              {conversation.map((msg, idx) => {
                const isAssistant = msg.role === "assistant";
                return (
                  <div
                    key={idx}
                    className={`flex gap-2.5 sm:gap-3.5 max-w-[92%] sm:max-w-[85%] ${
                      isAssistant ? "mr-auto items-start" : "ml-auto items-start flex-row-reverse"
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-sm shrink-0 select-none shadow-md ${
                        isAssistant
                          ? "bg-indigo-600 text-white shadow-indigo-600/30 ring-1 ring-white/10"
                          : "bg-slate-700 text-slate-100"
                      }`}
                    >
                      {isAssistant ? "🤖" : "👤"}
                    </div>

                    {/* Speech Bubble */}
                    <div className="space-y-1 max-w-[calc(100%-42px)]">
                      <div
                        className={`rounded-2xl px-4 sm:px-5 py-3 sm:py-4 text-sm leading-relaxed ${
                          isAssistant
                            ? "bg-slate-900 border border-slate-800 text-slate-100 shadow-md shadow-slate-950/40"
                            : "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        }`}
                      >
                        <div
                          className={`text-[11px] font-semibold uppercase tracking-wider mb-1 flex items-center justify-between gap-3 ${
                            isAssistant ? "text-indigo-400" : "text-indigo-200"
                          }`}
                        >
                          <span>
                            {isAssistant
                              ? msg.questionNumber
                                ? `Interviewer • Q${msg.questionNumber}`
                                : "AI Interviewer"
                              : "You"}
                          </span>
                          {msg.timestamp && (
                            <span className="text-[10px] opacity-70 font-normal">
                              {msg.timestamp}
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Thinking Indicator */}
              {isThinking && (
                <div className="flex gap-2.5 sm:gap-3.5 max-w-[88%] mr-auto items-start animate-in fade-in duration-200">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm shrink-0 shadow-md shadow-indigo-600/30">
                    🤖
                  </div>
                  <div className="rounded-2xl px-4 py-3 bg-slate-900 border border-slate-800 text-slate-300 shadow-md flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-xs text-slate-400 font-medium">
                      Interviewer is evaluating your response...
                    </span>
                  </div>
                </div>
              )}

              {/* Invisible anchor to scroll into view */}
              <div ref={messagesEndRef} />
            </div>

            {/* Answer Input Box & Send Button */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl backdrop-blur-sm">
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={candidateAnswer}
                  onChange={(e) => setCandidateAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isThinking}
                  placeholder={
                    isThinking
                      ? "Interviewer is reviewing..."
                      : "Type your answer here... (Enter to send, Shift+Enter for new line)"
                  }
                  className="w-full px-3.5 py-2.5 pb-10 sm:pb-11 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                />

                {/* Bottom bar inside textarea box */}
                <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between pointer-events-none">
                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    💡 <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Enter</kbd> to send • <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Shift+Enter</kbd> for new line
                  </span>
                  <span className="text-[11px] text-slate-500 sm:hidden">
                    {candidateAnswer.length > 0 ? `${candidateAnswer.length} chars` : "Shift+Enter for newline"}
                  </span>

                  <button
                    type="button"
                    onClick={handleSendAnswer}
                    disabled={!candidateAnswer.trim() || isThinking}
                    className="pointer-events-auto py-1.5 px-3.5 sm:px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md shadow-indigo-600/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                  >
                    {isThinking ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <span>Send</span>
                        <span className="text-indigo-200">↵</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            SCREEN 3: REPORT SCREEN
            ============================================================ */}
        {screen === "report" && (
          <div className="max-w-3xl mx-auto w-full py-4 sm:py-6 space-y-6 animate-in fade-in duration-200">
            {isGeneratingReport ? (
              /* Loading State */
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-10 sm:p-12 text-center shadow-2xl backdrop-blur-sm max-w-xl mx-auto my-8">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <span className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  Evaluating Your Interview...
                </h2>
                <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
                  Groq is analyzing your responses against the {difficulty} difficulty rubric, evaluating precision, depth, and problem-solving to compute your score and comprehensive report.
                </p>
              </div>
            ) : reportError ? (
              /* Error State with Retry Button */
              <div className="bg-rose-950/60 border border-rose-800 rounded-2xl p-8 text-center text-rose-200 max-w-xl mx-auto my-8 shadow-xl">
                <span className="text-4xl block mb-3">⚠️</span>
                <h2 className="text-xl font-bold text-white mb-2">
                  Could Not Generate Report
                </h2>
                <p className="text-sm text-rose-300 mb-6 leading-relaxed">
                  {reportError}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    type="button"
                    onClick={() => fetchReport(conversation)}
                    className="px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-all shadow-lg shadow-rose-600/30 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>🔄</span>
                    <span>Retry Generating Report</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-5 py-3 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors cursor-pointer"
                  >
                    Return to Start
                  </button>
                </div>
              </div>
            ) : report ? (
              /* ============================================================
                 INTERVIEW COMPLETE - REPORT VIEW
                 ============================================================ */
              (() => {
                const tier = getScoreTier(report.score);
                const isPass = report.pass_fail === "Pass";

                return (
                  <div className="space-y-6">
                    {/* Header: Title, Topic, Difficulty */}
                    <div className="border-b border-slate-800/80 pb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-400 mb-2">
                          <span>Topic: <strong className="text-white">{topic}</strong></span>
                          <span>•</span>
                          <span
                            className={`px-2 py-0.5 rounded font-semibold border ${
                              DIFFICULTY_CONFIG[difficulty].badgeColor
                            }`}
                          >
                            {difficulty}
                          </span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                          Interview Complete
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">
                          Comprehensive evaluation based on {conversation.filter(m => m.role === "user").length} answered questions.
                        </p>
                      </div>

                      {/* Prominent PASS / FAIL Banner Badge */}
                      <div className="shrink-0 self-start sm:self-center">
                        <span
                          className={`inline-block px-5 py-2 rounded-xl font-black text-base tracking-widest uppercase border shadow-xl ${
                            isPass
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-emerald-950/40"
                              : "bg-rose-500/20 text-rose-300 border-rose-500/60 shadow-rose-950/40"
                          }`}
                        >
                          {isPass ? "PASS ✓" : "FAIL ✗"}
                        </span>
                      </div>
                    </div>

                    {/* Score Card: Big & Colour-coded (good / okay / weak) */}
                    <div
                      className={`rounded-2xl p-6 sm:p-8 border shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-6 ${tier.boxBg} ${tier.boxBorder}`}
                    >
                      <div className="text-center sm:text-left">
                        <div className="flex items-center justify-center sm:justify-start gap-2.5 mb-2">
                          <span
                            className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider border ${tier.badgeBg}`}
                          >
                            Rating: {tier.label}
                          </span>
                          <span className="text-xs text-slate-400">
                            • {report.score >= 70 ? "Above Passing Threshold (70+)" : "Below Passing Threshold (70+)"}
                          </span>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-bold text-white">
                          Overall Technical Score
                        </h2>
                        <p className="text-slate-300 text-sm mt-1.5 max-w-md">
                          {tier.summaryText}
                        </p>
                      </div>

                      {/* Big Score Number */}
                      <div className="shrink-0 text-center">
                        <div
                          className={`inline-flex flex-col items-center justify-center w-32 h-32 rounded-2xl border bg-slate-950/70 ${tier.boxBorder} shadow-lg`}
                        >
                          <span className={`text-5xl font-black tracking-tight ${tier.textColor}`}>
                            {report.score}
                          </span>
                          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mt-0.5">
                            out of 100
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Section 1: Interviewer's Verdict */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                        <span>📋</span> Interviewer&apos;s Verdict
                      </h2>
                      <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                        {report.overall_verdict}
                      </p>
                    </div>

                    {/* Section 2: Strengths */}
                    <div className="bg-slate-900/90 border border-emerald-900/40 rounded-2xl p-6 shadow-xl">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3.5 flex items-center gap-2">
                        <span>✓</span> Strengths
                      </h2>
                      {report.strengths && report.strengths.length > 0 ? (
                        <ul className="space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed">
                          {report.strengths.map((item, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <span className="text-emerald-400 font-bold shrink-0 mt-0.5">•</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500 italic">No specific strengths recorded.</p>
                      )}
                    </div>

                    {/* Section 3: Areas for Improvement */}
                    <div className="bg-slate-900/90 border border-rose-900/40 rounded-2xl p-6 shadow-xl">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-rose-400 mb-3.5 flex items-center gap-2">
                        <span>✗</span> Areas for Improvement
                      </h2>
                      {report.weaknesses && report.weaknesses.length > 0 ? (
                        <ul className="space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed">
                          {report.weaknesses.map((item, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <span className="text-rose-400 font-bold shrink-0 mt-0.5">•</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500 italic">No significant gaps detected.</p>
                      )}
                    </div>

                    {/* Section 4: Topics to Revise */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3.5 flex items-center gap-2">
                        <span>📚</span> Topics to Revise
                      </h2>
                      {report.topics_to_revise && report.topics_to_revise.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {report.topics_to_revise.map((topicItem, i) => (
                            <span
                              key={i}
                              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-950/60 border border-indigo-800/80 text-indigo-300 font-medium shadow-sm"
                            >
                              {topicItem}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">No revision topics suggested.</p>
                      )}
                    </div>

                    {/* Bottom Action Buttons */}
                    <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
                      <button
                        type="button"
                        onClick={handleReset}
                        className="w-full sm:w-auto py-3.5 px-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-xl shadow-indigo-600/25 cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99]"
                      >
                        <span>Start New Interview</span>
                        <span className="text-indigo-200">→</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyReport}
                        className="w-full sm:w-auto py-3.5 px-6 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
                      >
                        <span>{copiedNotification ? "✓ Copied to Clipboard" : "📋 Copy Full Report"}</span>
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : null}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 py-4 sm:py-5 text-center text-xs text-slate-500">
        AI Interview Coach • Powered by Groq • FastAPI + Next.js
      </footer>
    </div>
  );
}
