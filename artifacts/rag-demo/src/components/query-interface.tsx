import React, { useState, useRef } from "react";
import type { RagQueryResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Zap, Cpu, Clock, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type StreamedState = {
  steps: RagQueryResult["processingSteps"];
  retrievedChunks: RagQueryResult["retrievedChunks"];
  answer: string;
  done: boolean;
  generateMs: number;
};

const INITIAL_STATE: StreamedState = {
  steps: [],
  retrievedChunks: [],
  answer: "",
  done: false,
  generateMs: 0,
};

export function QueryInterface() {
  const [question, setQuestion] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [streamed, setStreamed] = useState<StreamedState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isRunning) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setIsRunning(true);
    setStreamed({ ...INITIAL_STATE });

    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/rag/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, topK: 3 }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const events = buf.split("\n\n");
        buf = events.pop() ?? "";

        for (const block of events) {
          const lines = block.trim().split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(5).trim());

          if (event === "steps") {
            setStreamed((s) => s ? { ...s, steps: data.steps } : s);
          } else if (event === "chunks") {
            setStreamed((s) => s ? { ...s, retrievedChunks: data.retrievedChunks } : s);
          } else if (event === "answer") {
            setStreamed((s) => s ? { ...s, answer: s.answer + data.token } : s);
          } else if (event === "done") {
            setStreamed((s) =>
              s
                ? {
                    ...s,
                    done: true,
                    generateMs: data.generateMs,
                    steps: [
                      ...s.steps,
                      { step: "Generate", description: "Streamed answer from language model", durationMs: data.generateMs },
                    ],
                  }
                : s
            );
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        console.error("Stream error:", err);
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-background shadow-lg shadow-primary/5">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-mono flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            Query Engine
          </CardTitle>
          <CardDescription>Ask questions against the knowledge base.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              placeholder="e.g., What is backpropagation?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="font-mono text-sm bg-background border-border/50 focus-visible:ring-primary h-11"
              disabled={isRunning}
            />
            <Button
              type="submit"
              className="h-11 px-6 font-mono bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isRunning || !question.trim()}
            >
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              {isRunning ? "" : "Run RAG"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isRunning && (!streamed || streamed.steps.length === 0) && (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-xl bg-primary/20 animate-pulse" />
            <Cpu className="w-12 h-12 text-primary animate-pulse relative z-10" />
          </div>
          <div className="text-sm font-mono text-muted-foreground animate-pulse">Embedding query...</div>
        </div>
      )}

      {streamed && (streamed.steps.length > 0 || streamed.retrievedChunks.length > 0 || streamed.answer) && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Pipeline Steps */}
          {streamed.steps.length > 0 && (
            <div className="p-4 rounded-md bg-secondary/30 border border-border/40">
              <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" /> Pipeline Execution
              </h4>
              <div className="flex flex-col gap-2">
                {streamed.steps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-sm font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                    <div className="w-28 text-right text-xs text-primary/80 shrink-0">{step.step}</div>
                    <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden relative">
                      <div
                        className="absolute top-0 left-0 bottom-0 bg-primary/50 rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, Math.max(5, (step.durationMs / 3000) * 100))}%` }}
                      />
                    </div>
                    <div className="w-16 text-xs text-muted-foreground shrink-0">{step.durationMs}ms</div>
                  </div>
                ))}
                {isRunning && streamed.steps.length > 0 && !streamed.done && (
                  <div className="flex items-center gap-3 text-sm font-mono opacity-60">
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                    <div className="w-28 text-right text-xs text-primary/60 shrink-0">Generate</div>
                    <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-primary/30 animate-pulse rounded-full w-full" />
                    </div>
                    <div className="w-16 text-xs text-muted-foreground shrink-0">streaming…</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Streaming Answer */}
          {streamed.answer && (
            <Card className="border-primary/30 bg-background/50 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono flex items-center gap-2 text-primary">
                  <Zap className="w-4 h-4 fill-primary" />
                  Synthesized Answer
                  {isRunning && !streamed.done && (
                    <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-1 rounded-sm" />
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-mono leading-relaxed text-foreground whitespace-pre-wrap">
                  {streamed.answer}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Retrieved Context */}
          {streamed.retrievedChunks.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
                Retrieved Context ({streamed.retrievedChunks.length} chunks · semantic similarity)
              </h4>
              <div className="grid gap-3">
                {streamed.retrievedChunks.map((chunk, idx) => (
                  <div key={chunk.id} className="p-3 rounded border border-border/40 bg-card relative">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex gap-2 items-center">
                        <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary bg-primary/5 rounded-sm px-1 py-0">
                          Rank #{idx + 1}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
                          {chunk.documentTitle}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted-foreground">Similarity</span>
                        <span className="text-xs font-mono font-bold text-primary">
                          {(chunk.score * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-1 bg-background rounded-full mb-3 overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${chunk.score * 100}%`, opacity: Math.max(0.3, chunk.score) }}
                      />
                    </div>
                    <p className="text-xs text-foreground/70 font-mono leading-relaxed">
                      {chunk.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
