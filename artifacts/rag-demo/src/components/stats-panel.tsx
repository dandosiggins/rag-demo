import React from "react";
import { useGetRagStats } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Database, Hash, FileText, BrainCircuit } from "lucide-react";

export function StatsPanel() {
  const { data: stats } = useGetRagStats();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <FileText className="w-5 h-5 text-muted-foreground mb-2" />
          <div className="text-2xl font-bold font-mono">{stats?.documentCount || 0}</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-1">Documents</div>
        </CardContent>
      </Card>
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <Database className="w-5 h-5 text-primary mb-2" />
          <div className="text-2xl font-bold font-mono text-primary">{stats?.chunkCount || 0}</div>
          <div className="text-[10px] uppercase tracking-widest text-primary/70 font-mono mt-1">Chunks</div>
        </CardContent>
      </Card>
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <Hash className="w-5 h-5 text-muted-foreground mb-2" />
          <div className="text-2xl font-bold font-mono">{stats?.totalWords || 0}</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-1">Words</div>
        </CardContent>
      </Card>
      <Card className="bg-card/50 border-primary/20">
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <BrainCircuit className="w-5 h-5 text-primary mb-2" />
          <div className="text-xs font-bold font-mono text-primary leading-tight">all-MiniLM-L6-v2</div>
          <div className="text-[10px] uppercase tracking-widest text-primary/70 font-mono mt-1">Semantic Embeddings</div>
        </CardContent>
      </Card>
    </div>
  );
}
