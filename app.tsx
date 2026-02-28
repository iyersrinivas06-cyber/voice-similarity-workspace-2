import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  Handle,
  Position,
} from "reactflow";
import { Plus, Download, Upload, Trash2, Link2, Search, ClipboardCopy, ClipboardPaste, Check } from "lucide-react";

/**
 * Voice Similarity Node Workspace (Blender-style)
 *
 * NOTE about ChatGPT Canvas:
 * - Clipboard API is often blocked by a permissions policy.
 * - Therefore "Copy JSON" opens a modal and supports manual copy (and best-effort execCommand fallback).
 */

// -----------------------------
// Simple UI primitives (no external UI libs)
// -----------------------------
function Card({ className = "", children }: any) {
  return (
    <div
      className={`rounded-2xl border shadow-lg ${className}`}
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {children}
    </div>
  );
}
function CardHeader({ className = "", children }: any) {
  return (
    <div className={`px-4 py-3 border-b ${className}`} style={{ borderColor: "var(--border)" }}>
      {children}
    </div>
  );
}
function CardTitle({ className = "", children }: any) {
  return (
    <div className={`font-semibold ${className}`} style={{ color: "var(--text)" }}>
      {children}
    </div>
  );
}
function CardContent({ className = "", children }: any) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
function Button({ className = "", variant = "primary", size = "md", type = "button", children, ...props }: any) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition active:scale-[0.99]";
  const sizes: any = { sm: "h-8 px-2.5", md: "h-9 px-3" };
  const variants: any = {
    primary: { background: "var(--primary)", color: "var(--primaryText)", borderColor: "transparent" },
    secondary: { background: "var(--mutedBg)", color: "var(--text)", borderColor: "var(--border)" },
    destructive: { background: "var(--danger)", color: "#fff", borderColor: "transparent" },
  };
  return (
    <button
      type={type}
      className={`${base} ${sizes[size] || sizes.md} ${className}`}
      style={variants[variant] || variants.primary}
      {...props}
    >
      {children}
    </button>
  );
}
function Input({ className = "", ...props }: any) {
  return (
    <input
      className={`h-9 w-full rounded-xl border px-3 text-sm outline-none focus:ring-2 ${className}`}
      style={{ background: "var(--input)", color: "var(--text)", borderColor: "var(--border)", boxShadow: "none" }}
      {...props}
    />
  );
}
function Textarea({ className = "", ...props }: any) {
  return (
    <textarea
      className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 ${className}`}
      style={{ background: "var(--input)", color: "var(--text)", borderColor: "var(--border)", boxShadow: "none" }}
      {...props}
    />
  );
}
function Label({ className = "", children }: any) {
  return (
    <div className={`text-xs font-medium ${className}`} style={{ color: "var(--muted)" }}>
      {children}
    </div>
  );
}

// -----------------------------
// Storage + share
// -----------------------------
const LS_KEY = "voice_similarity_graph_v1";
const THEME_KEY = "voice_similarity_theme_v1";
const URL_HASH_PREFIX = "vsgraph=";

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToBytes(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeGraphToHash(obj: any) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  const b64url = base64UrlEncode(bytes);
  return `#${URL_HASH_PREFIX}${b64url}`;
}

function decodeGraphFromHash(hash: string) {
  if (!hash || !hash.startsWith(`#${URL_HASH_PREFIX}`)) return null;
  const b64url = hash.slice((`#${URL_HASH_PREFIX}`).length);
  const bytes = base64UrlDecodeToBytes(b64url);
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function uid(prefix = "n") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeEdges(es: any[]) {
  return (es || []).map((e) => ({
    type: "smoothstep",
    labelShowBg: true,
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 6,
    style: { stroke: "var(--edge)" },
    labelStyle: { fill: "var(--labelText)", fontWeight: 700 },
    labelBgStyle: { fill: "var(--labelBg)", stroke: "var(--border)" },
    ...e,
  }));
}

function downloadJson(filename: string, obj: any) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeParseGraphJson(text: string) {
  const parsed: any = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON object");
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("JSON must contain nodes[] and edges[]");
  return parsed;
}

// -----------------------------
// Custom node
// -----------------------------
function VoiceNode({ data, selected }: any) {
  const styles: string[] = data.styles?.length ? data.styles : [];

  return (
    <div
      className={`rounded-2xl border shadow-lg min-w-[240px] max-w-[340px] ${selected ? "ring-2 ring-white/30" : ""}`}
      style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
    >
      <div className="px-3 py-2 border-b flex items-start justify-between gap-2" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0">
          <div className="font-semibold truncate">{data.name || "Untitled Voice"}</div>
          <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
            {data.voiceId ? `ID: ${data.voiceId}` : "No ID"}
          </div>
        </div>
        <div
          className="text-xs px-2 py-1 rounded-full border whitespace-nowrap"
          style={{ borderColor: "var(--border)", background: "var(--pill)", color: "var(--muted)" }}
        >
          {data.group || "Ungrouped"}
        </div>
      </div>

      <div className="px-3 py-2">
        <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>
          Speaking styles
        </div>
        {styles.length ? (
          <div className="flex flex-wrap gap-1">
            {styles.slice(0, 8).map((s) => (
              <span
                key={s}
                className="text-xs px-2 py-1 rounded-full border"
                style={{ background: "var(--pill)", borderColor: "var(--border)", color: "var(--text)" }}
              >
                {s}
              </span>
            ))}
            {styles.length > 8 ? (
              <span
                className="text-xs px-2 py-1 rounded-full border"
                style={{ background: "var(--pill)", borderColor: "var(--border)", color: "var(--text)" }}
              >
                +{styles.length - 8}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="text-xs italic" style={{ color: "var(--muted)" }}>
            None
          </div>
        )}

        {data.notes ? (
          <div className="mt-2 text-xs line-clamp-3" style={{ color: "var(--muted)" }}>
            {data.notes}
          </div>
        ) : null}
      </div>

      <Handle type="target" position={Position.Left} className="!w-3 !h-3" style={{ background: "var(--edge)" }} />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3" style={{ background: "var(--edge)" }} />
    </div>
  );
}

const nodeTypes: any = { voice: VoiceNode };

// -----------------------------
// Dev tests (lightweight)
// -----------------------------
function runDevTests() {
  try {
    const payload = { nodes: [{ id: "a" }], edges: [{ id: "e", label: "x – dash" }], theme: "dark" };
    const h = encodeGraphToHash(payload);
    const d: any = decodeGraphFromHash(h);
    console.assert(d && d.theme === "dark" && d.edges?.[0]?.label === "x – dash", "share-link encode/decode failed");

    const payload2 = { nodes: [], edges: [], theme: "light" };
    const d2: any = decodeGraphFromHash(encodeGraphToHash(payload2));
    console.assert(d2 && d2.theme === "light", "theme roundtrip failed");

    const enc = h.slice((`#${URL_HASH_PREFIX}`).length);
    console.assert(!/[+/=]/.test(enc), "base64url encoding failed");

    console.assert(
      (() => {
        const ok = safeParseGraphJson(JSON.stringify({ nodes: [], edges: [], theme: "dark" }));
        return Array.isArray(ok.nodes) && Array.isArray(ok.edges);
      })(),
      "safeParseGraphJson failed for valid payload"
    );
    let threw = false;
    try {
      safeParseGraphJson(JSON.stringify({ nope: true }));
    } catch {
      threw = true;
    }
    console.assert(threw, "safeParseGraphJson should throw on missing nodes/edges");
  } catch (e) {
    console.warn("Dev tests failed", e);
  }
}

// -----------------------------
// Main app
// -----------------------------
function VoiceSimilarityWorkspace() {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem(THEME_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<any[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any[]>([]);

  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) || null, [edges, selectedEdgeId]);

  const [form, setForm] = useState({ name: "", voiceId: "", group: "Ungrouped", stylesText: "", notes: "" });
  const [edgeLabel, setEdgeLabel] = useState("");

  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [jsonModalMode, setJsonModalMode] = useState<"copy" | "paste">("copy");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonInfo, setJsonInfo] = useState<string | null>(null);
  const jsonTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const themeVars = useMemo(() => {
    if (theme === "light") {
      return {
        "--bg": "#f6f6f7",
        "--card": "#ffffff",
        "--text": "#0b0d12",
        "--muted": "rgba(11,13,18,0.60)",
        "--border": "rgba(11,13,18,0.12)",
        "--input": "#ffffff",
        "--primary": "#0b0d12",
        "--primaryText": "#ffffff",
        "--danger": "#dc2626",
        "--pill": "rgba(11,13,18,0.06)",
        "--edge": "#0b0d12",
        "--labelBg": "rgba(11,13,18,0.10)",
        "--labelText": "#0b0d12",
        "--mutedBg": "rgba(11,13,18,0.06)",
      } as any;
    }

    return {
      "--bg": "#0b0d12",
      "--card": "#111318",
      "--text": "rgba(255,255,255,0.92)",
      "--muted": "rgba(255,255,255,0.65)",
      "--border": "rgba(255,255,255,0.14)",
      "--input": "#1b1f27",
      "--primary": "#ffffff",
      "--primaryText": "#0b0d12",
      "--danger": "#ef4444",
      "--pill": "rgba(255,255,255,0.10)",
      "--edge": "#ffffff",
      "--labelBg": "rgba(255,255,255,0.90)",
      "--labelText": "#0b0d12",
      "--mutedBg": "rgba(255,255,255,0.10)",
    } as any;
  }, [theme]);

  const defaultEdgeOptions = useMemo(() => normalizeEdges([{}])[0], []);

  useEffect(() => {
    runDevTests();
  }, []);

  const [shareLoadError, setShareLoadError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const rawHash = window.location.hash || "";
      const fromHash: any = decodeGraphFromHash(rawHash);
      if (fromHash?.nodes || fromHash?.edges) {
        setShareLoadError(null);
        if (fromHash.theme === "dark" || fromHash.theme === "light") {
          setTheme(fromHash.theme);
          try {
            localStorage.setItem(THEME_KEY, fromHash.theme);
          } catch {}
        }
        setNodes(fromHash.nodes || []);
        setEdges(normalizeEdges(fromHash.edges || []));
        return;
      }
    } catch {
      if (window.location.hash.startsWith(`#${URL_HASH_PREFIX}`)) {
        setShareLoadError("This share link looks corrupted or was truncated. Try copying it again, or use Copy JSON.");
      }
    }

    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setNodes(parsed.nodes || []);
        setEdges(normalizeEdges(parsed.edges || []));
        return;
      }
    } catch {}

    const a = uid("v");
    const b = uid("v");
    setNodes([
      {
        id: a,
        type: "voice",
        position: { x: 120, y: 120 },
        data: { name: "Voice A", voiceId: "", group: "English", styles: ["Neutral 1 - Calm"], notes: "Starter node" },
      },
      {
        id: b,
        type: "voice",
        position: { x: 520, y: 140 },
        data: { name: "Voice B", voiceId: "", group: "English", styles: ["News Headlines"], notes: "" },
      },
    ]);
    setEdges(normalizeEdges([{ id: uid("e"), source: a, target: b, label: "8/10 – similar timbre", animated: true }]));
  }, [setNodes, setEdges]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ nodes, edges }));
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [nodes, edges, theme]);

  const hashTimerRef = useRef<any>(null);
  useEffect(() => {
    const isShare = window.location.hash.startsWith(`#${URL_HASH_PREFIX}`);
    if (!isShare) return;

    if (hashTimerRef.current) clearTimeout(hashTimerRef.current);
    hashTimerRef.current = setTimeout(() => {
      try {
        const newHash = encodeGraphToHash({ nodes, edges, theme });
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      } catch {}
    }, 500);

    return () => {
      if (hashTimerRef.current) clearTimeout(hashTimerRef.current);
    };
  }, [nodes, edges, theme]);

  const nodesForView = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return nodes;

    const matches = new Set(
      nodes
        .filter((n) => {
          const d = n.data || {};
          const hay = [d.name, d.voiceId, d.group, (d.styles || []).join(" "), d.notes].join(" ").toLowerCase();
          return hay.includes(q);
        })
        .map((n) => n.id)
    );

    return nodes.map((n) => ({
      ...n,
      style: matches.has(n.id) ? undefined : { opacity: 0.22 },
    }));
  }, [nodes, search]);

  useEffect(() => {
    if (!selectedNode) return;
    setSelectedEdgeId(null);
    setForm({
      name: selectedNode.data?.name || "",
      voiceId: selectedNode.data?.voiceId || "",
      group: selectedNode.data?.group || "Ungrouped",
      stylesText: (selectedNode.data?.styles || []).join(", "),
      notes: selectedNode.data?.notes || "",
    });
  }, [selectedNodeId, selectedNode]);

  useEffect(() => {
    if (!selectedEdge) return;
    setSelectedNodeId(null);
    setEdgeLabel(selectedEdge.label || "");
  }, [selectedEdgeId, selectedEdge]);

  const onConnect = useCallback(
    (params: any) => {
      setEdges((eds) =>
        addEdge(
          normalizeEdges([
            {
              ...params,
              id: uid("e"),
              label: "",
              animated: true,
            },
          ])[0],
          eds
        )
      );
    },
    [setEdges]
  );

  const addVoiceNode = useCallback(() => {
    const id = uid("v");
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "voice",
        position: { x: 160 + Math.random() * 280, y: 120 + Math.random() * 260 },
        data: { name: "New Voice", voiceId: "", group: "Ungrouped", styles: [], notes: "" },
      },
    ]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }, [setNodes]);

  const applyEdits = useCallback(() => {
    if (!selectedNodeId) return;
    const styles = form.stylesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setNodes((ns) =>
      ns.map((n) =>
        n.id === selectedNodeId
          ? { ...n, data: { ...n.data, name: form.name, voiceId: form.voiceId, group: form.group, styles, notes: form.notes } }
          : n
      )
    );
  }, [selectedNodeId, form, setNodes]);

  const saveEdgeLabel = useCallback(() => {
    if (!selectedEdgeId) return;
    setEdges((es) => es.map((e) => (e.id === selectedEdgeId ? { ...e, label: edgeLabel } : e)));
  }, [selectedEdgeId, edgeLabel, setEdges]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
    setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId, setNodes, setEdges]);

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    setEdges((es) => es.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges]);

  const exportGraph = useCallback(() => {
    downloadJson(`voice-similarity-graph-${new Date().toISOString().slice(0, 10)}.json`, { nodes, edges, theme });
  }, [nodes, edges, theme]);

  const openCopyJson = useCallback(() => {
    setJsonModalMode("copy");
    setJsonError(null);
    setJsonInfo("Select all and copy (Ctrl/Cmd+C). Clipboard is blocked in some Canvas sessions.");
    setJsonText(JSON.stringify({ nodes, edges, theme }, null, 2));
    setIsJsonModalOpen(true);
  }, [nodes, edges, theme]);

  const openPasteJson = useCallback(() => {
    setJsonModalMode("paste");
    setJsonError(null);
    setJsonInfo(null);
    setJsonText("");
    setIsJsonModalOpen(true);
  }, []);

  const importFromJsonText = useCallback(() => {
    try {
      setJsonError(null);
      const parsed = safeParseGraphJson(jsonText);
      if (parsed.theme === "dark" || parsed.theme === "light") setTheme(parsed.theme);
      setNodes(parsed.nodes);
      setEdges(normalizeEdges(parsed.edges));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setIsJsonModalOpen(false);
    } catch (e: any) {
      setJsonError(e?.message || "Invalid JSON");
    }
  }, [jsonText, setNodes, setEdges]);

  const importGraph = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = safeParseGraphJson(String(reader.result || "{}"));
          if (parsed.theme === "dark" || parsed.theme === "light") setTheme(parsed.theme);
          setNodes(parsed.nodes || []);
          setEdges(normalizeEdges(parsed.edges || []));
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
        } catch {
          alert("Could not import JSON. Make sure it contains nodes[] and edges[].");
        }
      };
      reader.readAsText(file);
    },
    [setNodes, setEdges]
  );

  const clearAll = useCallback(() => {
    if (!confirm("Clear the entire workspace? This cannot be undone.")) return;
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
  }, [setNodes, setEdges]);

  const copyShareLink = useCallback(() => {
    try {
      const hash = encodeGraphToHash({ nodes, edges, theme });
      const base = window.location.href.split("#")[0];
      const url = `${base}${hash}`;
      window.prompt("Copy this link:", url);
    } catch (e) {
      console.error(e);
      alert("Could not create share link.");
    }
  }, [nodes, edges, theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    if (!isJsonModalOpen) return;
    const t = setTimeout(() => {
      const el = jsonTextareaRef.current;
      if (!el) return;
      el.focus();
      if (jsonModalMode === "copy") el.setSelectionRange(0, el.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, [isJsonModalOpen, jsonModalMode]);

  const tryExecCopy = useCallback(() => {
    const el = jsonTextareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
    try {
      const ok = (document as any).execCommand?.("copy");
      if (ok) setJsonInfo("Copied. If it didn’t, press Ctrl/Cmd+C.");
      else setJsonInfo("Select all and press Ctrl/Cmd+C.");
    } catch {
      setJsonInfo("Select all and press Ctrl/Cmd+C.");
    }
  }, []);

  return (
    <div className="w-full h-[calc(100vh-2rem)] p-3 grid grid-cols-12 gap-3" style={{ background: "var(--bg)", ...themeVars } as any}>
      {/* Graph */}
      <Card className="col-span-12 lg:col-span-8 overflow-hidden">
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="w-4 h-4" /> Voice Similarity Workspace
              <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>
                {theme === "dark" ? "Dark" : "Light"}
              </span>
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
                <Input
                  value={search}
                  onChange={(e: any) => setSearch(e.target.value)}
                  placeholder="Search voices/styles/groups…"
                  className="pl-8 w-[240px]"
                />
              </div>

              <Button onClick={addVoiceNode} className="gap-2">
                <Plus className="w-4 h-4" /> Add voice
              </Button>

              <Button variant="secondary" onClick={toggleTheme} className="gap-2">
                Toggle {theme === "dark" ? "Light" : "Dark"}
              </Button>

              <Button variant="secondary" onClick={openCopyJson} className="gap-2">
                <ClipboardCopy className="w-4 h-4" /> Copy JSON
              </Button>

              <Button variant="secondary" onClick={openPasteJson} className="gap-2">
                <ClipboardPaste className="w-4 h-4" /> Paste JSON
              </Button>

              <Button variant="secondary" onClick={exportGraph} className="gap-2">
                <Download className="w-4 h-4" /> Export
              </Button>

              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="w-4 h-4" /> Import
              </Button>

              <Button variant="secondary" onClick={copyShareLink} className="gap-2">
                <Link2 className="w-4 h-4" /> Copy link
              </Button>

              <Button variant="destructive" onClick={clearAll} className="gap-2">
                <Trash2 className="w-4 h-4" /> Clear
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e: any) => {
                  const f = e.target.files?.[0];
                  if (f) importGraph(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Drag nodes to arrange them. Drag from a node’s right socket to another node’s left socket to create a link.
            Click an edge to edit its label.
          </div>

          {shareLoadError ? (
            <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              <span style={{ color: theme === "dark" ? "#fca5a5" : "#b91c1c" }}>Share link issue:</span> {shareLoadError}
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          <div className="w-full h-[calc(100vh-10.5rem)]">
            <ReactFlow
              nodes={nodesForView}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
              onNodeClick={(_, n: any) => {
                setSelectedNodeId(n.id);
                setSelectedEdgeId(null);
              }}
              onEdgeClick={(_, e: any) => {
                setSelectedEdgeId(e.id);
                setSelectedNodeId(null);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
              }}
              defaultEdgeOptions={defaultEdgeOptions}
              proOptions={{ hideAttribution: true }}
            >
              <Background color={theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)"} gap={22} />
              <Controls />
              <MiniMap
                zoomable
                pannable
                style={{ background: theme === "dark" ? "#0b0d12" : "#ffffff" }}
                nodeColor={() => (theme === "dark" ? "#ffffff" : "#0b0d12")}
                maskColor={theme === "dark" ? "rgba(11,13,18,0.75)" : "rgba(255,255,255,0.70)"}
              />
            </ReactFlow>
          </div>
        </CardContent>
      </Card>

      {/* JSON Modal */}
      {isJsonModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="w-full max-w-2xl rounded-2xl border shadow-2xl" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div className="font-semibold" style={{ color: "var(--text)" }}>
                {jsonModalMode === "copy" ? "Copy Graph JSON" : "Paste Graph JSON"}
              </div>
              <Button variant="secondary" onClick={() => setIsJsonModalOpen(false)}>
                Close
              </Button>
            </div>

            <div className="px-4 py-3 space-y-2">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {jsonModalMode === "copy"
                  ? "Select all and copy (Ctrl/Cmd+C). Then send the JSON to someone and they can Paste JSON in their canvas."
                  : "Paste JSON exported from this app (or someone else’s) to load the same workspace."}
              </div>

              <Textarea
                ref={jsonTextareaRef as any}
                rows={12}
                value={jsonText}
                onChange={(e: any) => setJsonText(e.target.value)}
                readOnly={jsonModalMode === "copy"}
                placeholder={jsonModalMode === "paste" ? "Paste the JSON here…" : ""}
              />

              {jsonError ? (
                <div className="text-xs" style={{ color: theme === "dark" ? "#fca5a5" : "#b91c1c" }}>
                  {jsonError}
                </div>
              ) : null}

              {jsonInfo ? (
                <div className="text-xs flex items-center gap-2" style={{ color: "var(--muted)" }}>
                  <Check className="w-4 h-4" /> {jsonInfo}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-1">
                {jsonModalMode === "copy" ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const el = jsonTextareaRef.current;
                        if (!el) return;
                        el.focus();
                        el.setSelectionRange(0, el.value.length);
                        setJsonInfo("Selected — now press Ctrl/Cmd+C.");
                      }}
                    >
                      Select all
                    </Button>
                    <Button onClick={tryExecCopy}>Copy</Button>
                  </>
                ) : (
                  <Button onClick={importFromJsonText}>Import</Button>
                )}
                <Button variant="secondary" onClick={() => setIsJsonModalOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Inspector */}
      <Card className="col-span-12 lg:col-span-4">
        <CardHeader>
          <CardTitle className="text-base">Inspector</CardTitle>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Select a voice node or click an edge to edit its label.
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {!selectedNode && !selectedEdge ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Nothing selected.
              <div className="mt-2 text-xs">Tip: click a node to edit metadata, or click a link to label it.</div>
            </div>
          ) : selectedEdge ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label>Edge label (score / rationale)</Label>
                <Input value={edgeLabel} onChange={(e: any) => setEdgeLabel(e.target.value)} placeholder="e.g., 8/10 – similar timbre" />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={saveEdgeLabel} className="flex-1">
                  Save label
                </Button>
                <Button variant="destructive" onClick={deleteSelectedEdge} className="gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </Button>
              </div>

              <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Labels show directly on the connection line.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e: any) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>

                <div className="space-y-1">
                  <Label>Voice ID (optional)</Label>
                  <Input value={form.voiceId} onChange={(e: any) => setForm((f) => ({ ...f, voiceId: e.target.value }))} />
                </div>

                <div className="space-y-1">
                  <Label>Group</Label>
                  <Input value={form.group} onChange={(e: any) => setForm((f) => ({ ...f, group: e.target.value }))} />
                </div>

                <div className="space-y-1">
                  <Label>Speaking styles (comma-separated)</Label>
                  <Textarea
                    rows={3}
                    value={form.stylesText}
                    onChange={(e: any) => setForm((f) => ({ ...f, stylesText: e.target.value }))}
                    placeholder="Neutral 1 - Calm, News Headlines"
                  />
                </div>

                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Textarea rows={4} value={form.notes} onChange={(e: any) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={applyEdits} className="flex-1">
                  Save changes
                </Button>
                <Button variant="destructive" onClick={deleteSelectedNode} className="gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Mount */
createRoot(document.getElementById("root")!).render(<VoiceSimilarityWorkspace />);
export default VoiceSimilarityWorkspace;