import React, { useState } from "react";
import { DocumentIngest } from "@/components/document-ingest";
import { ChunkVisualizer } from "@/components/chunk-visualizer";
import { QueryInterface } from "@/components/query-interface";
import { StatsPanel } from "@/components/stats-panel";

export default function Home() {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground font-mono selection:bg-primary/30">
      
      {/* Background Pattern */}
      <div className="fixed inset-0 pointer-events-none opacity-20" style={{ 
        backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--primary)) 1px, transparent 0)`,
        backgroundSize: `40px 40px`
      }} />

      <main className="container max-w-6xl mx-auto py-10 px-4 relative z-10 space-y-10">
        
        {/* Header */}
        <header className="flex flex-col items-center justify-center text-center space-y-4 mb-12">
          <div className="inline-flex items-center justify-center p-2 bg-primary/10 rounded-lg border border-primary/20 mb-2">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-primary fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold tracking-tight">RAG<span className="text-primary">.pipeline</span></h1>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            An interactive visualization of Retrieval-Augmented Generation. 
            Watch text be chunked, embedded, and retrieved to ground language model generation.
          </p>
        </header>

        <StatsPanel />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Knowledge Base */}
          <div className="lg:col-span-5 space-y-6">
            <div className="sticky top-6 space-y-6">
              <DocumentIngest onDocumentSelect={setSelectedDocumentId} />
              {selectedDocumentId && <ChunkVisualizer documentId={selectedDocumentId} />}
            </div>
          </div>

          {/* Right Column: Query Engine */}
          <div className="lg:col-span-7">
            <QueryInterface />
          </div>

        </div>

      </main>
    </div>
  );
}
