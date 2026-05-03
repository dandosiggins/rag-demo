import React, { useState } from "react";
import { useRagQuery } from "@workspace/api-client-react";
import type { RagQueryResult } from "@workspace/api-client-react/src/generated/api.schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Zap, Cpu, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function QueryInterface() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<RagQueryResult | null>(null);
  
  const queryRag = useRagQuery();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setResult(null);
    queryRag.mutate(
      { data: { question, topK: 3 } },
      {
        onSuccess: (data) => {
          setResult(data);
        }
      }
    );
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
              disabled={queryRag.isPending}
            />
            <Button 
              type="submit" 
              className="h-11 px-6 font-mono bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={queryRag.isPending || !question.trim()}
            >
              {queryRag.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              {queryRag.isPending ? "" : "Run RAG"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {queryRag.isPending && (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-xl bg-primary/20 animate-pulse" />
            <Cpu className="w-12 h-12 text-primary animate-pulse relative z-10" />
          </div>
          <div className="text-sm font-mono text-muted-foreground animate-pulse">Running pipeline...</div>
        </div>
      )}

      {result && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Pipeline Steps Visualization */}
          <div className="p-4 rounded-md bg-secondary/30 border border-border/40">
            <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Pipeline Execution
            </h4>
            <div className="flex flex-col gap-2">
              {result.processingSteps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-3 text-sm font-mono">
                  <div className="w-24 text-right text-xs text-primary/80">{step.step}</div>
                  <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden relative">
                    <div 
                      className="absolute top-0 left-0 bottom-0 bg-primary/50 rounded-full" 
                      style={{ width: `${Math.min(100, Math.max(5, (step.durationMs / 1500) * 100))}%` }} 
                    />
                  </div>
                  <div className="w-16 text-xs text-muted-foreground">{step.durationMs}ms</div>
                </div>
              ))}
            </div>
          </div>

          {/* Generated Answer */}
          <Card className="border-primary/30 bg-background/50 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono flex items-center gap-2 text-primary">
                <Zap className="w-4 h-4 fill-primary" />
                Synthesized Answer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-mono leading-relaxed text-foreground whitespace-pre-wrap">
                {result.answer}
              </p>
            </CardContent>
          </Card>

          {/* Retrieved Context */}
          <div className="space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Retrieved Context ({result.retrievedChunks.length} chunks)
            </h4>
            <div className="grid gap-3">
              {result.retrievedChunks.map((chunk, idx) => (
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
                      <span className="text-[10px] font-mono text-muted-foreground">Score</span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-mono font-bold text-primary">
                          {(chunk.score * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Score Bar */}
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

        </div>
      )}
    </div>
  );
}
