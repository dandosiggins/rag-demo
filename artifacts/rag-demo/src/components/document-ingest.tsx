import React, { useState, useRef } from "react";
import { useIngestDocument, getListDocumentsQueryKey, useListDocuments, useDeleteDocument, useClearAllDocuments, getGetRagStatsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, Database, AlignLeft, RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const SAMPLE_DOCS = [
  {
    title: "Introduction to Neural Networks",
    text: "A neural network is a machine learning model inspired by the human brain. It consists of layers of interconnected nodes, or neurons. The input layer receives the raw data, hidden layers process the information through weighted connections and activation functions, and the output layer produces the final prediction. Backpropagation is used to adjust the weights during training, minimizing the error between predicted and actual outputs. Deep learning refers to neural networks with many hidden layers, capable of learning hierarchical representations of complex data such as images, audio, and text.",
  },
  {
    title: "What is RAG?",
    text: "Retrieval-Augmented Generation (RAG) is a technique that enhances large language models by grounding their responses in external knowledge bases. When a query is received, the RAG system first retrieves relevant documents or chunks of text from a vector database using semantic search. These retrieved context chunks are then prepended to the user's prompt and fed to the LLM, allowing it to synthesize a response based on the newly provided facts rather than relying solely on its internal training data. RAG reduces hallucinations and enables LLMs to answer questions about private or up-to-date information.",
  },
];

export function DocumentIngest({ onDocumentSelect }: { onDocumentSelect: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isUploadPending, setIsUploadPending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents, isLoading: isLoadingDocs } = useListDocuments();
  const ingestDoc = useIngestDocument();
  const deleteDoc = useDeleteDocument();
  const clearAll = useClearAllDocuments();

  const isPending = ingestDoc.isPending || isUploadPending;

  const handleIngest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;

    ingestDoc.mutate(
      { data: { title, text, chunkSize: 80 } },
      {
        onSuccess: (res) => {
          setTitle("");
          setText("");
          toast({ title: "Document Ingested", description: `Created ${res.chunks.length} chunks from ${res.chunks.reduce((n, c) => n + c.wordCount, 0)} words.` });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRagStatsQueryKey() });
          onDocumentSelect(res.document.id);
        },
        onError: () => {
          toast({ title: "Ingestion Failed", variant: "destructive" });
        },
      }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    const isTxt = file.name.toLowerCase().endsWith(".txt") || file.type === "text/plain";

    if (!isPdf && !isTxt) {
      toast({ title: "Only .pdf and .txt files are supported", variant: "destructive" });
      e.target.value = "";
      return;
    }

    const inferredTitle = file.name.replace(/\.(pdf|txt)$/i, "");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title || inferredTitle);
    formData.append("chunkSize", "80");

    setIsUploadPending(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/rag/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Upload failed");
      }

      const res = await response.json() as {
        document: { id: string };
        chunks: Array<{ wordCount: number }>;
      };

      setTitle("");
      setText("");
      toast({
        title: "Document Ingested",
        description: `Created ${res.chunks.length} chunks from ${res.chunks.reduce((n, c) => n + c.wordCount, 0)} words.`,
      });
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetRagStatsQueryKey() });
      onDocumentSelect(res.document.id);
    } catch (err) {
      toast({
        title: "Upload Failed",
        description: err instanceof Error ? err.message : "Failed to ingest file",
        variant: "destructive",
      });
    } finally {
      setIsUploadPending(false);
    }

    e.target.value = "";
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
        },
      }
    );
  };

  const handleClearAll = () => {
    clearAll.mutate(undefined, {
      onSuccess: (res) => {
        toast({
          title: "Knowledge Base Cleared",
          description: `Deleted ${res.deletedDocuments} document${res.deletedDocuments !== 1 ? "s" : ""} and ${res.deletedChunks} chunk${res.deletedChunks !== 1 ? "s" : ""}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRagStatsQueryKey() });
      },
      onError: () => {
        toast({ title: "Clear Failed", variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-background shadow-lg">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-mono flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Knowledge Base
          </CardTitle>
          <CardDescription>Paste text or upload a .txt / .pdf file to build the semantic index.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleIngest} className="space-y-4">
            <div className="space-y-2">
              {/* Sample loaders + file upload */}
              <div className="flex flex-wrap gap-2">
                {SAMPLE_DOCS.map((doc, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs font-mono border-primary/30 hover:bg-primary/10"
                    onClick={() => { setTitle(doc.title); setText(doc.text); }}
                    disabled={isPending}
                  >
                    Load Sample {i + 1}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs font-mono border-primary/30 hover:bg-primary/10 gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isPending}
                >
                  {isUploadPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  Upload .txt / .pdf
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf,text/plain,application/pdf"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>

              <Input
                placeholder="Document Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="font-mono text-sm bg-background border-border/50 focus-visible:ring-primary"
                disabled={isPending}
              />
              <Textarea
                placeholder="Paste document text here to be chunked and embedded with all-MiniLM-L6-v2..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[120px] font-mono text-sm resize-none bg-background border-border/50 focus-visible:ring-primary"
                disabled={isPending}
              />
            </div>
            <Button
              type="submit"
              className="w-full font-mono bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isPending || !title.trim() || !text.trim()}
            >
              {ingestDoc.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              {ingestDoc.isPending ? "Embedding chunks..." : "Ingest & Embed"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <AlignLeft className="w-4 h-4" />
            Ingested Documents
          </h3>
          {documents && documents.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs font-mono text-muted-foreground hover:text-destructive gap-1.5 h-7 px-2"
                  disabled={clearAll.isPending}
                >
                  {clearAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Clear All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all documents?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {documents.length} document{documents.length !== 1 ? "s" : ""}, their chunks, and embeddings from the database. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleClearAll}
                  >
                    Clear All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {isLoadingDocs ? (
          <div className="flex justify-center p-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
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
            No documents yet. Paste text or upload a .txt / .pdf file above.
          </div>
        )}
      </div>
    </div>
  );
}
