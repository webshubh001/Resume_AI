import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  serverTimestamp,
  doc,
  getDocFromServer
} from "firebase/firestore";
import { auth, db, handleFirestoreError } from "./firebase";
import { 
  FileText, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Briefcase, 
  GraduationCap, 
  Star, 
  ArrowRight,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  X,
  LogOut,
  User as UserIcon,
  Clock,
  Columns,
  Layers,
  ShieldCheck,
  Check,
  Download
} from "lucide-react";
import { cn } from "./lib/utils";

interface Experience {
  company: string;
  role: string;
  period: string;
  description: string[];
}

interface Education {
  institution: string;
  degree: string;
  year: string;
}

interface ResumeData {
  name: string;
  contact: { email: string; phone: string; location: string };
  skills: string[];
  experience: Experience[];
  education: Education[];
  summary: string;
  score: number;
  feedback: { strengths: string[]; weaknesses: string[]; atsTips: string[]; suggestions: string[] };
}

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url?: string;
  source: string;
}

interface Match {
  jobId: string;
  matchScore: number;
  explanation: string;
}

interface AnalysisDoc {
  id: string;
  userId: string;
  resumeData: ResumeData;
  jobs: Job[];
  matches: Record<string, Match>;
  fileName: string;
  isDefault: boolean;
  createdAt: any;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [matches, setMatches] = useState<Record<string, Match>>({});
  const [matchingInProgress, setMatchingInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisDoc[]>([]);
  const [comparisonItems, setComparisonItems] = useState<AnalysisDoc[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (e) {
        // Silent connect check
      }
    };
    checkConnection();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchHistory(currentUser.uid);
      } else {
        setHistory([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchHistory = async (uid: string) => {
    try {
      const q = query(
        collection(db, "analyses"),
        where("userId", "==", uid),
        orderBy("createdAt", "desc")
      );
      const querySnapshot = await getDocs(q);
      const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AnalysisDoc));
      setHistory(items);
      
      // Auto-load default if current is empty
      const defaultItem = items.find(i => i.isDefault);
      if (defaultItem && !resumeData) {
        setResumeData(defaultItem.resumeData);
        setJobs(defaultItem.jobs);
        setMatches(defaultItem.matches);
      }
    } catch (err) {
      console.error("History fetch error:", err);
    }
  };

  const setDefaultResume = async (id: string) => {
    if (!user) return;
    try {
      const { updateDoc, doc: fireDoc } = await import("firebase/firestore");
      // This is a simplified "set default" (local first)
      // In production you might want a transaction to unset others, but here we can just update the one
      // and update local state to reflect it.
      await updateDoc(fireDoc(db, "analyses", id), { isDefault: true });
      
      // Update others to false
      const others = history.filter(h => h.id !== id && h.isDefault);
      for (const other of others) {
        await updateDoc(fireDoc(db, "analyses", other.id), { isDefault: false });
      }
      fetchHistory(user.uid);
    } catch (err: any) {
      handleFirestoreError(err, 'update', `analyses/${id}`);
    }
  };

  const toggleComparison = (item: any) => {
    setComparisonItems(prev => {
      const exists = prev.find(p => p.id === item.id);
      if (exists) return prev.filter(p => p.id !== item.id);
      if (prev.length >= 2) return [prev[1], item];
      return [...prev, item];
    });
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setError(null);
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      setAuthMode(null);
    } catch (err: any) {
      if (err.code === "auth/invalid-credential") {
        setError("Invalid email or password. Please check your credentials.");
      } else if (err.code === "auth/operation-not-allowed") {
        setError("Email/Password sign-in is disabled. Please enable it in Firebase Console or use Google Login.");
      } else if (err.code === "auth/email-already-in-use") {
        setError("An account with this email already exists.");
      } else {
        setError(err.message);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setAuthMode(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const saveAnalysis = async (data: ResumeData, jobsData: Job[], matchesData: Record<string, Match>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "analyses"), {
        userId: user.uid,
        resumeData: data,
        jobs: jobsData,
        matches: matchesData,
        fileName: file?.name || "Resume",
        isDefault: history.length === 0, // First one is default
        createdAt: serverTimestamp(),
      });
      fetchHistory(user.uid);
    } catch (err: any) {
      handleFirestoreError(err, 'create', 'analyses');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== "application/pdf") {
        setError("Only PDF files are supported currently.");
        return;
      }
      setFile(selectedFile);
      analyzeResume(selectedFile);
    }
  };

  const analyzeResume = async (file: File) => {
    setLoading(true);
    setError(null);
    setResumeData(null);
    setJobs([]);
    setMatches({});

    const formData = new FormData();
    formData.append("resume", file);

    try {
      // 1. Get raw text from server
      const textResponse = await fetch("/api/analyze-resume", {
        method: "POST",
        body: formData,
      });

      if (!textResponse.ok) {
        const errorData = await textResponse.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || "File parsing failed");
      }
      const { text: resumeText } = await textResponse.json();

      // 2. Analyze with Gemini in frontend
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `
        Analyze the following resume text and provide a structured JSON response.
        The JSON should have:
        - name: string
        - contact: { email: string, phone: string, location: string }
        - skills: string[]
        - experience: { company: string, role: string, period: string, description: string[] }[]
        - education: { institution: string, degree: string, year: string }[]
        - summary: string (brief professional summary)
        - score: number (0-100 based on keyword density, structure, and professional tone)
        - feedback: { strengths: string[], weaknesses: string[], atsTips: string[], suggestions: string[] }

        Resume Text:
        ${resumeText}
      `;

      const aiResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const data = JSON.parse(aiResponse.text);
      setResumeData(data);
      fetchJobs(data);
    } catch (err: any) {
      setError(err.message || "An error occurred while analyzing the resume.");
    } finally {
      setLoading(false);
    }
  };

  const fetchJobs = async (data: ResumeData) => {
    setMatchingInProgress(true);
    try {
      const query = data.skills.slice(0, 3).join(" ");
      const response = await fetch("/api/fetch-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location: data.contact.location }),
      });

      if (!response.ok) throw new Error("Job fetch failed");
      const jobsData = await response.json();
      setJobs(jobsData);
      matchJobs(data, jobsData);
    } catch (err) {
      console.error("Job fetch error:", err);
    } finally {
      setMatchingInProgress(false);
    }
  };

  const matchJobs = async (resume: ResumeData, jobsList: Job[]) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `
        Compare the following resume data against these job listings.
        Rate each job from 0-100 on how well it matches the resume.
        Provide a brief explanation for each match.
        Return as JSON array: { jobId: string, matchScore: number, explanation: string }

        Resume Skills: ${resume.skills.join(", ")}
        Resume Summary: ${resume.summary}

        Jobs:
        ${JSON.stringify(jobsList)}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const matchesData = JSON.parse(response.text);
      const matchMap: Record<string, Match> = {};
      matchesData.forEach((m: Match) => {
        matchMap[m.jobId] = m;
      });
      setMatches(matchMap);
      if (user) {
        saveAnalysis(resume, jobsList, matchMap);
      }
    } catch (err) {
      console.error("Matching error:", err);
    }
  };

  const reset = () => {
    setFile(null);
    setResumeData(null);
    setJobs([]);
    setMatches({});
    setError(null);
  };

  const downloadJSON = () => {
    if (!resumeData) return;
    const exportData = {
      ...resumeData,
      jobs,
      matches,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analysis_${resumeData.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen flex flex-col bg-bg text-text-main font-sans overflow-hidden">
      {/* Header */}
      <header className="h-[64px] border-b border-border bg-surface flex items-center justify-between px-6 shrink-0 relative z-20">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-accent rounded flex items-center justify-center text-white">
            <Sparkles className="w-4 h-4" />
          </div>
          <h1 className="text-[18px] font-extrabold tracking-tight">PARSE.AI <span className="text-text-dim font-normal text-sm ml-2">/ Resume Intelligence</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-text-dim px-3 py-1 bg-white/5 rounded-full border border-border hidden md:block">
            Engine: Gemini 3 Flash
          </div>
          <div className="flex items-center gap-3 h-full">
            {user ? (
              <div className="flex items-center gap-3 border-l border-border pl-4">
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-bold text-text-main leading-none">{user.email?.split('@')[0]}</p>
                </div>
                <button 
                  onClick={() => signOut(auth)}
                  className="p-2 text-text-dim hover:text-white transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setAuthMode("login")}
                className="text-xs font-bold uppercase tracking-widest text-accent hover:opacity-80 transition-all px-3 h-full"
              >
                Sign In
              </button>
            )}
            {resumeData && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={downloadJSON}
                  className="bg-surface border border-border text-text-main px-4 py-2 rounded-md text-sm font-semibold hover:bg-white/5 transition-all flex items-center gap-2"
                  title="Download analysis as JSON"
                >
                  <Download className="w-4 h-4" />
                  JSON
                </button>
                <button 
                  onClick={reset}
                  className="bg-accent text-white px-4 py-2 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  New Analysis
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative z-10">
        <AnimatePresence>
          {authMode && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-md flex items-center justify-center p-6"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-surface border border-border p-10 rounded-[2rem] w-full max-w-md shadow-2xl relative"
              >
                <button onClick={() => setAuthMode(null)} className="absolute top-6 right-6 text-text-dim hover:text-white">
                  <X className="w-5 h-5" />
                </button>
                <h3 className="text-2xl font-black mb-2 uppercase tracking-tighter">
                  {authMode === "login" ? "Welcome Back" : "Create Account"}
                </h3>
                <p className="text-text-dim text-sm mb-8">
                  {authMode === "login" ? "Sign in to access your saved resume history." : "Register to start saving your analysis results."}
                </p>
                
                <form onSubmit={handleAuth} className="space-y-4">
                  <input 
                    type="email" 
                    placeholder="Email Address"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-bg border border-border p-4 rounded-xl text-sm focus:border-accent outline-none transition-all"
                  />
                  <input 
                    type="password" 
                    placeholder="Password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-bg border border-border p-4 rounded-xl text-sm focus:border-accent outline-none transition-all"
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button 
                    type="submit" 
                    disabled={authLoading}
                    className="w-full bg-accent text-white p-4 rounded-xl font-bold uppercase tracking-widest text-xs hover:opacity-90 disabled:opacity-50 transition-all"
                  >
                    {authLoading ? "Processing..." : authMode === "login" ? "Sign In" : "Register"}
                  </button>
                </form>

                <div className="relative my-8">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border"></span>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-surface px-2 text-text-dim">Or continue with</span>
                  </div>
                </div>

                <button 
                  onClick={handleGoogleSignIn}
                  disabled={authLoading}
                  className="w-full bg-bg border border-border text-white p-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-surface transition-all disabled:opacity-50"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Google
                </button>
                
                <div className="mt-8 pt-8 border-t border-border text-center">
                  <button 
                    onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                    className="text-xs text-text-dim hover:text-accent transition-colors"
                  >
                    {authMode === "login" ? "Don't have an account? Register" : "Already have an account? Sign In"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {!resumeData && !loading ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xl"
            >
              <div className="inline-block px-3 py-1 bg-accent/10 border border-accent/20 text-accent rounded-full text-xs font-bold uppercase tracking-wider mb-6">
                Next-Gen Matching
              </div>
              <h2 className="text-5xl md:text-6xl font-black tracking-tight mb-6 leading-tight">
                Unlock your <br />
                career <span className="text-accent underline underline-offset-8 decoration-accent/30">potential</span>
              </h2>
              <p className="text-lg text-text-dim mb-12 max-w-md mx-auto">
                Advanced AI analysis to decode your resume and find high-precision job matches.
              </p>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="group relative cursor-pointer"
              >
                <div className="absolute -inset-2 bg-accent/20 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition duration-500"></div>
                <div className="relative bg-surface border border-border p-12 rounded-[2rem] flex flex-col items-center gap-6 hover:border-accent/50 transition-all shadow-2xl">
                  <div className="w-16 h-16 bg-accent/10 text-accent rounded-2xl flex items-center justify-center shadow-inner">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-1">Select Resume (PDF)</h3>
                    <p className="text-sm text-text-dim">Drag and drop or click to analyze</p>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept=".pdf"
                    onChange={handleFileUpload}
                  />
                </div>
              </div>
              
              {error && (
                <div className="mt-8 p-4 bg-red-500/10 text-red-500 rounded-xl flex items-center gap-3 border border-red-500/20">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-semibold">{error}</p>
                </div>
              )}
            </motion.div>
          </div>
        ) : loading ? (
          <div className="h-full flex flex-col items-center justify-center bg-bg/50 backdrop-blur-sm">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
              className="mb-6"
            >
              <RefreshCw className="w-10 h-10 text-accent" />
            </motion.div>
            <h2 className="text-xl font-bold mb-1">Processing Resume</h2>
            <p className="text-text-dim text-sm">Our AI is extracting metadata & structural insights</p>
          </div>
        ) : resumeData && (
          <div className="h-full grid grid-cols-1 lg:grid-cols-[280px_1fr_300px]">
            {/* Left Box: Profile Metadata */}
            <aside className="border-r border-border bg-bg/50 flex flex-col overflow-hidden">
              <div className="p-5 border-b border-border shrink-0">
                <span className="text-[10px] uppercase font-bold tracking-[2px] text-text-dim">Profile Metadata</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div className="text-center mb-10">
                  <div className="w-[120px] h-[120px] rounded-full border-[8px] border-border border-t-accent flex items-center justify-center mx-auto mb-6 relative">
                    <span className="text-3xl font-bold font-mono">{resumeData.score}</span>
                  </div>
                  <h3 className="text-lg font-bold truncate px-2">{resumeData.name}</h3>
                  <p className="text-xs text-text-dim mt-2">{resumeData.contact.location}</p>
                </div>

                <div className="mb-10">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-text-dim mb-4">Extracted Skills</p>
                  <div className="flex flex-wrap gap-2">
                    {resumeData.skills.map((skill, i) => (
                      <span key={i} className="bg-[#1E1E22] border border-border px-2 py-1 rounded text-[11px] font-mono text-accent">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-text-dim mb-4">Experience</p>
                  <div className="border-l-2 border-border pl-4 space-y-6">
                    {resumeData.experience.slice(0, 3).map((exp, i) => (
                      <div key={i} className="relative">
                        <div className="absolute -left-[18px] top-1.5 w-2 h-2 rounded-full bg-border" />
                        <p className="text-sm font-bold truncate">{exp.company}</p>
                        <p className="text-[11px] text-text-dim mt-1">{exp.role} • {exp.period}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {history.length > 0 && (
                  <div className="mt-12 pt-12 border-t border-border">
                    <div className="flex justify-between items-center mb-4">
                      <p className="text-[10px] uppercase font-bold tracking-wider text-text-dim flex items-center gap-2">
                        <Clock className="w-3 h-3" /> History & Versions
                      </p>
                      {comparisonItems.length > 0 && (
                        <button 
                          onClick={() => setIsComparing(!isComparing)}
                          className={cn(
                            "text-[10px] uppercase font-bold px-2 py-1 rounded transition-all",
                            isComparing ? "bg-accent text-white" : "bg-white/5 text-text-dim hover:text-white"
                          )}
                        >
                          {isComparing ? "Exit Preview" : `Compare (${comparisonItems.length})`}
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {history.slice(0, 8).map((item, i) => (
                        <div 
                          key={item.id} 
                          className={cn(
                            "p-3 bg-white/5 border border-border rounded-lg cursor-pointer transition-all group relative",
                            comparisonItems.find(p => p.id === item.id) ? "border-accent ring-1 ring-accent/30" : "hover:border-accent"
                          )}
                        >
                          <div className="flex justify-between items-start mb-2">
                             <div 
                               onClick={() => {
                                 setResumeData(item.resumeData);
                                 setJobs(item.jobs);
                                 setMatches(item.matches);
                                 setIsComparing(false);
                               }}
                               className="flex-1 min-w-0"
                             >
                               <p className="text-xs font-bold truncate group-hover:text-accent flex items-center gap-2">
                                 {item.resumeData.name}
                                 {item.isDefault && <ShieldCheck className="w-3 h-3 text-accent" />}
                               </p>
                               <p className="text-[10px] text-text-dim mt-0.5">{new Date(item.createdAt?.seconds * 1000).toLocaleDateString()}</p>
                             </div>
                             <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button 
                                 onClick={() => toggleComparison(item)}
                                 className={cn("p-1.5 rounded bg-bg/50 hover:text-white", comparisonItems.find(p => p.id === item.id) ? "text-accent" : "text-text-dim")}
                                 title="Compare"
                               >
                                 <Columns className="w-3 h-3" />
                               </button>
                               {!item.isDefault && (
                                 <button 
                                   onClick={() => setDefaultResume(item.id)}
                                   className="p-1.5 rounded bg-bg/50 text-text-dim hover:text-accent"
                                   title="Set as Default"
                                 >
                                   <Star className="w-3 h-3" />
                                 </button>
                               )}
                             </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>

            {/* Center: Job Matches OR Comparison */}
            {isComparing && comparisonItems.length >= 1 ? (
              <section className="bg-[#0D0D0E] flex flex-col overflow-hidden border-r border-border">
                <div className="p-5 border-b border-border flex justify-between items-center shrink-0">
                  <span className="text-[10px] uppercase font-bold tracking-[2px] text-text-dim">Side-by-Side Comparison</span>
                  <button onClick={() => setIsComparing(false)} className="text-[10px] text-accent font-bold uppercase hover:underline">
                    Back to Matches
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                  <div className="grid grid-cols-2 gap-6 h-full">
                    {comparisonItems.map((item, i) => (
                      <div key={item.id} className="flex flex-col h-full bg-surface/50 border border-border rounded-xl p-6">
                        <div className="text-center mb-8">
                          <div className="w-[80px] h-[80px] rounded-full border-4 border-border border-t-accent flex items-center justify-center mx-auto mb-4 relative">
                            <span className="text-xl font-bold font-mono">{item.resumeData.score}</span>
                          </div>
                          <p className="text-xs font-bold uppercase tracking-widest text-text-dim mb-1">
                            {item.isDefault ? "Current Default" : `Version #${history.length - history.indexOf(item)}`}
                          </p>
                          <h4 className="text-lg font-black truncate">{item.resumeData.name}</h4>
                        </div>
                        
                        <div className="space-y-6">
                          <div>
                            <p className="text-[10px] uppercase font-bold tracking-widest text-accent mb-3">Key Skills</p>
                            <div className="flex flex-wrap gap-1.5">
                              {item.resumeData.skills.slice(0, 10).map((s: string, j: number) => (
                                <span key={j} className="text-[10px] bg-bg border border-border px-1.5 py-0.5 rounded text-text-dim">
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] uppercase font-bold tracking-widest text-orange-400 mb-3">Principal Weakness</p>
                            <p className="text-xs text-text-dim leading-relaxed italic">
                              {item.resumeData.feedback.weaknesses[0]}
                            </p>
                          </div>

                          <div>
                            <p className="text-[10px] uppercase font-bold tracking-widest text-text-main mb-3">Top Strength</p>
                            <p className="text-xs text-[#C1C1C8] leading-relaxed">
                              {item.resumeData.feedback.strengths[0]}
                            </p>
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            setResumeData(item.resumeData);
                            setJobs(item.jobs);
                            setMatches(item.matches);
                            setIsComparing(false);
                          }}
                          className="mt-auto pt-6 text-[10px] font-bold text-accent uppercase tracking-widest text-center hover:underline"
                        >
                          Switch to this analysis
                        </button>
                      </div>
                    ))}
                    {comparisonItems.length === 1 && (
                      <div className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl opacity-30 text-center p-6">
                         <Layers className="w-8 h-8 mb-3" />
                         <p className="text-xs">Select another resume from history to compare</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ) : (
              <section className="bg-[#0D0D0E] flex flex-col overflow-hidden border-r border-border">
              <div className="p-5 border-b border-border flex justify-between items-center shrink-0">
                <span className="text-[10px] uppercase font-bold tracking-[2px] text-text-dim">Smart Job Matches</span>
                <span className="text-[10px] text-accent font-bold uppercase tracking-widest">Source: Analytics API</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar py-6">
                <div className="space-y-4 px-6">
                  <AnimatePresence>
                    {jobs.map((job, index) => {
                      const match = matches[job.id];
                      return (
                        <motion.div
                          key={job.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className="group bg-surface border border-border p-5 rounded-lg hover:border-accent transition-all cursor-pointer shadow-sm"
                        >
                          <div className="flex justify-between items-start mb-3">
                            {match ? (
                              <span className="bg-accent/10 text-accent text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                                {match.matchScore}% Match
                              </span>
                            ) : (
                              <div className="h-4 w-16 bg-border/50 animate-pulse rounded-full" />
                            )}
                            <span className="text-[10px] text-text-dim uppercase font-bold tracking-tighter italic opacity-50">#00{index + 1}</span>
                          </div>
                          <h4 className="text-[15px] font-bold group-hover:text-accent transition-colors leading-snug">{job.title}</h4>
                          <p className="text-xs text-text-dim mt-1 mb-4 flex items-center gap-1">
                            {job.company} <span className="opacity-30">•</span> {job.location}
                          </p>
                          {match?.explanation ? (
                            <p className="text-xs text-[#C1C1C8] leading-relaxed line-clamp-2 italic">
                              {match.explanation}
                            </p>
                          ) : (
                            <p className="text-xs text-text-dim leading-relaxed italic opacity-40">Predicting alignment based on vector similarity...</p>
                          )}
                          <div className="mt-4 flex justify-end">
                            <a 
                              href={job.url || "#"} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[11px] font-bold text-accent uppercase tracking-widest hover:underline flex items-center gap-1"
                            >
                              View Opportunity <ArrowRight className="w-3 h-3" />
                            </a>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>

                {jobs.length === 0 && !matchingInProgress && (
                  <div className="h-full flex flex-col items-center justify-center p-12 text-center opacity-30">
                    <Briefcase className="w-12 h-12 mb-4" />
                    <p className="text-sm">No matched opportunities detected in this cycle.</p>
                  </div>
                )}
              </div>
            </section>
            )}

            {/* Right: LLM Insights */}
            <aside className="bg-surface flex flex-col overflow-hidden">
              <div className="p-5 border-b border-border shrink-0">
                <span className="text-[10px] uppercase font-bold tracking-[2px] text-text-dim">LLM Insights</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
                <div className="p-6 border-b border-border">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-accent mb-4">Principal Strengths</p>
                  <div className="space-y-4">
                    {resumeData.feedback.strengths.slice(0, 2).map((s, i) => (
                      <p key={i} className="text-[13px] leading-relaxed text-[#C1C1C8]">
                        <span className="text-accent mr-2">▹</span>
                        {s}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="p-6 border-b border-border">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-orange-400 mb-4">Strategic Gaps</p>
                  <div className="space-y-3">
                    {resumeData.feedback.weaknesses.slice(0, 3).map((w, i) => (
                      <div key={i} className="flex gap-3 text-[12px] text-[#C1C1C8]">
                        <span className="text-orange-400">▹</span>
                        {w}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-6 flex-1">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-text-dim mb-4">ATS Intelligence</p>
                  <p className="text-[12px] text-text-dim leading-relaxed">
                    {resumeData.feedback.suggestions[0]}
                  </p>
                </div>

                <div className="p-6 border-t border-border bg-bg/30">
                  <p className="text-[11px] text-text-dim mb-3 italic">Ask about this profile:</p>
                  <div className="bg-bg border border-border rounded p-3 text-[12px] text-text-dim opacity-50 cursor-not-allowed">
                    How can I pivot to Lead Engineer?
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>
      
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #2D2D30; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3E7BFA; }
      `}} />
    </div>
  );
}
