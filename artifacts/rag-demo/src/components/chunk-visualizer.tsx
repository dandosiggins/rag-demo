import React from "react";
import { useGetDocumentChunks, getGetDocumentChunksQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ChunkVisualizer({ documentId }: { documentId: string | null }) {
  const { data: chunks, isLoading } = useGetDocumentChunks(documentId || "", {
    query: {
      enabled: !!documentId,
      queryKey: getGetDocumentChunksQueryKey(documentId || "")
    }
  });

  if (!documentId) {
    return null;
  }

  return (
    <Card className="border-border/50 bg-background shadow-lg">
      <CardHeader className="pb-3 border-b border-border/30">
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Chunk Space View
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : chunks && chunks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {chunks.map((chunk) => (
              <div 
                key={chunk.id} 
                className="p-3 rounded border border-border/40 bg-secondary/20 relative group"
              >
                <div className="flex justify-between items-center mb-2">
                  <Badge variant="outline" className="font-mono text-[10px] border-primary/30 text-primary bg-primary/5 rounded-sm px-1 py-0">
                    Chunk #{chunk.index}
                  </Badge>
                  <span className="text-[10px] font-mono text-muted-foreground">{chunk.wordCount} words</span>
                </div>
                <p className="text-xs text-foreground/80 font-mono leading-relaxed line-clamp-4">
                  {chunk.text}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center p-6 text-sm text-muted-foreground font-mono">
            No chunks found for this document.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
