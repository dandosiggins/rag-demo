import React, { useState } from "react";
import { useIngestDocument, getListDocumentsQueryKey, useListDocuments, useDeleteDocument, getGetRagStatsQueryKey, getGetDocumentChunksQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, Database, AlignLeft, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SAMPLE_DOCS = [
  {
    title: "Introduction to Neural Networks",
    text: "A neural network is a machine learning model inspired by the human brain. It consists of layers of interconnected nodes, or neurons. The input layer receives the raw data, hidden layers process the information through weighted connections and activation functions, and the output layer produces the final prediction. Backpropagation is used to adjust the weights during training, minimizing the error between predicted and actual outputs."
  },
  {
    title: "What is RAG?",
    text: "Retrieval-Augmented Generation (RAG) is a technique that enhances large language models by grounding their responses in external knowledge bases. When a query is received, the RAG system first retrieves relevant documents or chunks of text from a vector database using semantic search. These retrieved context chunks are then prepended to the user's prompt and fed to the LLM, allowing it to synthesize a response based on the newly provided facts rather than relying solely on its internal training data."
  }
];

export function DocumentIngest({ onDocumentSelect }: { onDocumentSelect: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: documents, isLoading: isLoadingDocs } = useListDocuments();
  const ingestDoc = useIngestDocument();
  const deleteDoc = useDeleteDocument();

  const handleIngest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;

    ingestDoc.mutate(
      { data: { title, text, chunkSize: 50 } },
      {
        onSuccess: (res) => {
          setTitle("");
          setText("");
          toast({ title: "Document Ingested", description: `Created ${res.chunks.length} chunks.` });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRagStatsQueryKey() });
          onDocumentSelect(res.document.id);
        },
        onError: () => {
          toast({ title: "Ingestion Failed", variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteDoc.mutate(
      { documentId: id },
      {
        onSuccess: () => {
          toast({ title: "Document Deleted" });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRagStatsQueryKey() });
          // Note: should probably clear selected document if it was this one, but handled by parent potentially.
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-background shadow-lg">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-mono flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Knowledge Base
          </CardTitle>
          <CardDescription>Ingest text to build the vector index.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleIngest} className="space-y-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                {SAMPLE_DOCS.map((doc, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs font-mono border-primary/30 hover:bg-primary/10"
                    onClick={() => {
                      setTitle(doc.title);
                      setText(doc.text);
                    }}
                  >
                    Load Sample {i + 1}
                  </Button>
                ))}
              </div>
              <Input
                placeholder="Document Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="font-mono text-sm bg-background border-border/50 focus-visible:ring-primary"
                disabled={ingestDoc.isPending}
              />
              <Textarea
                placeholder="Paste document text here to be chunked and embedded..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[120px] font-mono text-sm resize-none bg-background border-border/50 focus-visible:ring-primary"
                disabled={ingestDoc.isPending}
              />
            </div>
            <Button 
              type="submit" 
              className="w-full font-mono bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={ingestDoc.isPending || !title.trim() || !text.trim()}
            >
              {ingestDoc.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              {ingestDoc.isPending ? "Ingesting..." : "Ingest & Chunk"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <AlignLeft className="w-4 h-4" />
          Ingested Documents
        </h3>
        {isLoadingDocs ? (
          <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : documents && documents.length > 0 ? (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div 
                key={doc.id} 
                onClick={() => onDocumentSelect(doc.id)}
                className="group relative p-3 rounded-md border border-border/50 bg-card hover:bg-secondary/50 cursor-pointer transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="pr-8">
                    <h4 className="font-mono text-sm font-medium text-foreground truncate">{doc.title}</h4>
                    <div className="flex gap-2 mt-1.5">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 rounded-sm font-mono bg-primary/10 text-primary border-primary/20">
                        {doc.chunkCount} chunks
                      </Badge>
                      <span className="text-[10px] text-muted-foreground font-mono self-center">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleDelete(doc.id, e)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center p-6 border border-dashed border-border/50 rounded-md text-sm text-muted-foreground font-mono">
            No documents yet.
          </div>
        )}
      </div>
    </div>
  );
}
