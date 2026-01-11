import React, { useState, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { generateTutorialContent, generateAudioSegments, createAudioBufferFromPCM, explainCodeSnippet } from './services/geminiService';
import { TutorialData, LoadingState } from './types';
import CodeBlock from './components/CodeBlock';
import { PlayIcon, PauseIcon, ReplayIcon, SparklesIcon, SendIcon, FilmIcon, BookOpenIcon } from './components/Icons';

const App: React.FC = () => {
  const [query, setQuery] = useState('');
  const [tutorialData, setTutorialData] = useState<TutorialData | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  // Audio handling
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0); // 0 = Overview, 1+ = Steps
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBuffersRef = useRef<AudioBuffer[]>([]);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  
  // Export handling
  const [isExporting, setIsExporting] = useState(false);
  const exportContainerRef = useRef<HTMLDivElement>(null);
  
  // Deep Dive State
  const [deepDiveContent, setDeepDiveContent] = useState<{title: string, content: string} | null>(null);
  const [isDeepDiveLoading, setIsDeepDiveLoading] = useState(false);
  
  // Track which buffer index is currently loaded in source
  const activeBufferIndexRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Reset state
    stopAudio();
    setLoadingState(LoadingState.GENERATING_CONTENT);
    setError(null);
    setTutorialData(null);
    audioBuffersRef.current = [];
    setCurrentStepIndex(0);
    activeBufferIndexRef.current = 0;
    pauseOffsetRef.current = 0;
    setDeepDiveContent(null);

    try {
      // 1. Generate Content
      const data = await generateTutorialContent(query);
      setTutorialData(data);
      
      // 2. Generate Audio Segments
      setLoadingState(LoadingState.GENERATING_AUDIO);
      const audioBase64s = await generateAudioSegments(data);
      
      // Decode audio immediately for smoother playback later
      const ctx = getAudioContext();
      const buffers = await Promise.all(audioBase64s.map(async (b64) => {
        if (b64) {
          return await createAudioBufferFromPCM(b64, ctx);
        } else {
          // Fallback: Create a silent 2-second buffer if TTS failed
          // This ensures the timeline logic works even if audio is missing
          return ctx.createBuffer(1, 2 * 24000, 24000); 
        }
      }));
      audioBuffersRef.current = buffers;
      
      setLoadingState(LoadingState.READY);
      
      // Auto play
      playAudio();

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred.");
      setLoadingState(LoadingState.ERROR);
    }
  };

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const playSegment = (index: number, offset: number = 0) => {
    const ctx = getAudioContext();
    if (index >= audioBuffersRef.current.length) {
      setIsPlaying(false);
      activeBufferIndexRef.current = 0;
      setCurrentStepIndex(0);
      pauseOffsetRef.current = 0;
      return;
    }

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffersRef.current[index];
    source.connect(ctx.destination);
    
    source.start(0, offset);
    startTimeRef.current = ctx.currentTime - offset;
    
    audioSourceRef.current = source;
    activeBufferIndexRef.current = index;
    setCurrentStepIndex(index);
    setIsPlaying(true);

    source.onended = () => {
      // Check if stopped manually (source.stop() triggers onended too usually, but we clear sourceRef on stop)
      if (audioSourceRef.current === source) {
        // Natural end of segment, play next
        playSegment(index + 1, 0);
      }
    };
  };

  const playAudio = () => {
    // Resume from current segment and offset
    playSegment(activeBufferIndexRef.current, pauseOffsetRef.current);
  };

  const pauseAudio = () => {
    const ctx = audioContextRef.current;
    if (audioSourceRef.current && ctx) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {}
      // Calculate pause offset
      pauseOffsetRef.current = ctx.currentTime - startTimeRef.current;
      // Safety cap (if offset > duration, just reset)
      if (pauseOffsetRef.current > (audioBuffersRef.current[activeBufferIndexRef.current]?.duration || 0)) {
          pauseOffsetRef.current = 0;
          activeBufferIndexRef.current++; // Move to next for safety
      }
      
      audioSourceRef.current = null; // Prevent onended from chaining
      setIsPlaying(false);
    }
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      // Prevent recursion in onended
      const src = audioSourceRef.current;
      audioSourceRef.current = null;
      try { src.stop(); } catch(e) {}
      src.disconnect();
    }
    setIsPlaying(false);
    activeBufferIndexRef.current = 0;
    setCurrentStepIndex(0);
    pauseOffsetRef.current = 0;
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  };

  const handleReplay = () => {
    stopAudio();
    playAudio();
  };

  const handleDeepDive = async (snippet: string) => {
    if (!tutorialData) return;
    
    pauseAudio(); // Auto pause when deep diving
    setIsDeepDiveLoading(true);
    setDeepDiveContent(null);
    
    try {
        const explanation = await explainCodeSnippet(snippet, tutorialData.title);
        setDeepDiveContent({
            title: snippet.length > 30 ? snippet.substring(0, 30) + '...' : snippet,
            content: explanation
        });
    } catch (e) {
        console.error(e);
    } finally {
        setIsDeepDiveLoading(false);
    }
  };

  const handleExportVideo = async () => {
    if (!exportContainerRef.current || isExporting || !tutorialData) return;
    
    stopAudio();
    setIsExporting(true);
    
    const ctx = getAudioContext();
    const dest = ctx.createMediaStreamDestination();
    
    // Create a canvas for the video stream
    const videoCanvas = document.createElement('canvas');
    // Set typical TikTok/Mobile resolution or match element
    const rect = exportContainerRef.current.getBoundingClientRect();
    videoCanvas.width = rect.width;
    videoCanvas.height = rect.height;
    const videoCtx = videoCanvas.getContext('2d');
    
    const videoStream = videoCanvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    // Check mime type support
    let mimeType = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
        mimeType = 'video/webm;codecs=h264';
    }

    const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 2500000 });
    const chunks: Blob[] = [];
    
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };
    
    recorder.start();
    
    // Iterate through all steps
    // 0 = overview, 1..n = steps
    const totalSteps = tutorialData.steps.length + 1;
    
    for (let i = 0; i < totalSteps; i++) {
        // 1. Update UI state to show this step
        setCurrentStepIndex(i);
        
        // 2. Wait for React to render the changes
        // Also pause the recorder so we don't record the "jump" or "render" frames if they lag
        recorder.pause();
        await new Promise(r => setTimeout(r, 500)); 
        
        // 3. Capture the DOM to an image
        const canvasShot = await html2canvas(exportContainerRef.current, {
            backgroundColor: '#0f172a',
            scale: 2 // High quality
        });
        
        // 4. Draw this "slide" to the video stream canvas
        // We will keep drawing this same image in a loop while audio plays, 
        // effectively creating a static slide with audio
        if (videoCtx) {
            videoCtx.drawImage(canvasShot, 0, 0, videoCanvas.width, videoCanvas.height);
        }

        // 5. Resume recording and Play Audio for this step
        recorder.resume();
        
        // If there is audio for this step
        if (i < audioBuffersRef.current.length) {
            const buffer = audioBuffersRef.current[i];
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(dest);
            source.start();
            
            // Loop draw to keep stream alive (required for some browsers to encode frames properly)
            const duration = buffer.duration * 1000;
            const startTime = Date.now();
            
            await new Promise<void>(resolve => {
                 const interval = setInterval(() => {
                     if (videoCtx) {
                         // Re-draw to keep stream fresh
                         videoCtx.drawImage(canvasShot, 0, 0, videoCanvas.width, videoCanvas.height);
                     }
                     if (Date.now() - startTime >= duration) {
                         clearInterval(interval);
                         resolve();
                     }
                 }, 33); // ~30fps
            });
        } else {
             await new Promise(r => setTimeout(r, 2000)); // Fallback if no audio logic (should rarely hit if buffers are padded)
        }
    }
    
    recorder.stop();
    
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `codecast-${tutorialData.title.replace(/\s+/g, '-').toLowerCase()}.mp4`; // Name it mp4 for user happiness
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsExporting(false);
        
        // Reset to beginning
        setCurrentStepIndex(0);
        activeBufferIndexRef.current = 0;
    };
  };

  // Determine which code snippet to highlight
  // Index 0 is Overview (no highlight)
  // Index 1 is Step 0 (tutorialData.steps[0])
  const currentHighlight = 
    tutorialData && currentStepIndex > 0 && currentStepIndex <= tutorialData.steps.length
      ? tutorialData.steps[currentStepIndex - 1].lineCode
      : null;

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col items-center">
      
      {/* Header */}
      <header className="w-full max-w-5xl px-6 py-8 flex flex-col items-center space-y-4">
        <div className="flex items-center space-x-3">
          <SparklesIcon className="w-8 h-8 text-cyan-400" />
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            CodeCast
          </h1>
        </div>
        <p className="text-slate-400 text-center max-w-lg">
          Ask a question. Get code. Listen to the explanation.
          <br />
          <span className="text-sm opacity-60">"Comment créer un bouton avec streamlit?"</span>
        </p>
      </header>

      {/* Input Section */}
      <section className="w-full max-w-3xl px-6 mb-10">
        <form onSubmit={handleSubmit} className="relative group">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="How do I center a div in CSS..."
            className="w-full bg-[#1e293b] border border-slate-700 text-slate-100 placeholder-slate-500 rounded-full py-4 pl-6 pr-14 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all shadow-lg"
            disabled={loadingState === LoadingState.GENERATING_CONTENT || loadingState === LoadingState.GENERATING_AUDIO || isExporting}
          />
          <button
            type="submit"
            disabled={loadingState === LoadingState.GENERATING_CONTENT || loadingState === LoadingState.GENERATING_AUDIO || isExporting}
            className="absolute right-2 top-2 p-2 bg-cyan-600 hover:bg-cyan-500 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
             {loadingState !== LoadingState.IDLE && loadingState !== LoadingState.READY && loadingState !== LoadingState.ERROR ? (
               <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
             ) : (
               <SendIcon className="w-5 h-5" />
             )}
          </button>
        </form>
        {error && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
                {error}
            </div>
        )}
      </section>

      {/* Loading States */}
      {(loadingState === LoadingState.GENERATING_CONTENT || loadingState === LoadingState.GENERATING_AUDIO) && (
        <div className="flex flex-col items-center justify-center space-y-4 my-10 animate-pulse">
          <div className="text-cyan-400 text-lg font-medium">
            {loadingState === LoadingState.GENERATING_CONTENT ? "Writing code..." : "Recording explanation..."}
          </div>
          <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
             <div className="h-full bg-cyan-500 animate-progress"></div>
          </div>
        </div>
      )}

      {/* Result Section */}
      {tutorialData && loadingState === LoadingState.READY && (
        <main ref={exportContainerRef} className={`w-full max-w-6xl px-4 lg:px-6 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in-up ${isExporting ? 'pointer-events-none' : ''}`}>
          
          {isExporting && (
             <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm">
                <div className="text-white text-2xl font-bold mb-4">Rendering Video...</div>
                <div className="text-slate-400">Please wait while we create your video.</div>
             </div>
          )}

          {/* Left Column: Code */}
          <div className="space-y-6 order-2 lg:order-1 relative">
             <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">{tutorialData.title}</h2>
             </div>
             
             <CodeBlock 
                code={tutorialData.code} 
                language={tutorialData.language} 
                highlight={currentHighlight}
             />
             
             <div className={`bg-slate-800/50 p-4 rounded-xl border border-slate-700 backdrop-blur-sm sticky bottom-4 shadow-xl z-10 ${isExporting ? 'opacity-0' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                        {currentStepIndex === 0 ? "Overview" : `Step ${currentStepIndex} of ${tutorialData.steps.length}`}
                    </span>
                    <div className="flex items-center space-x-2">
                         <button 
                            onClick={handleExportVideo}
                            className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"
                            title="Export to MP4"
                        >
                            <FilmIcon className="w-5 h-5" />
                        </button>
                        <div className="w-px h-4 bg-slate-700 mx-1"></div>
                        <button 
                            onClick={handleReplay}
                            className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"
                            title="Replay"
                        >
                            <ReplayIcon className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={handleTogglePlay}
                            className="p-3 bg-cyan-600 hover:bg-cyan-500 rounded-full text-white shadow-lg transition-transform active:scale-95"
                        >
                            {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
                        </button>
                    </div>
                </div>
                {/* Visualizer bars */}
                <div className="flex items-end justify-center space-x-1 h-8">
                     {[...Array(30)].map((_, i) => (
                         <div 
                            key={i} 
                            className={`w-1 bg-cyan-500/60 rounded-t transition-all duration-300 ${isPlaying ? 'animate-music-bar' : 'h-1'}`}
                            style={{ 
                                animationDelay: `${i * 0.05}s`, 
                                height: isPlaying ? undefined : '4px',
                                opacity: isPlaying ? 1 : 0.3
                            }}
                         ></div>
                     ))}
                </div>
             </div>
          </div>

          {/* Right Column: Explanations */}
          <div className="space-y-4 order-1 lg:order-2 h-fit">
             <h3 className="text-lg font-medium text-slate-300">Step-by-Step Breakdown</h3>
             <div className={`space-y-4 lg:max-h-[70vh] lg:overflow-y-auto pr-2 pb-10 scrollbar-thin ${isExporting ? 'overflow-visible max-h-none' : ''}`}>
                {/* Overview Card */}
                <div 
                    className={`
                        p-5 rounded-xl border transition-all duration-500 
                        ${currentStepIndex === 0 
                            ? 'border-cyan-500 bg-cyan-950/30 shadow-[0_0_20px_rgba(6,182,212,0.15)] transform scale-[1.02]' 
                            : 'border-slate-700/50 bg-slate-800/30 text-slate-400'
                        }
                    `}
                >
                    <p className={`leading-relaxed italic ${currentStepIndex === 0 ? 'text-white' : 'text-slate-500'}`}>
                        "{tutorialData.overview}"
                    </p>
                </div>

                {/* Steps */}
                {tutorialData.steps.map((step, idx) => {
                    const stepNum = idx + 1;
                    const isActive = currentStepIndex === stepNum;
                    
                    return (
                        <div 
                            key={idx} 
                            id={`step-${stepNum}`}
                            className={`
                                group p-5 rounded-xl border transition-all duration-300 relative overflow-hidden
                                ${isActive 
                                    ? 'border-cyan-500 bg-[#1e293b] shadow-lg shadow-cyan-900/20 ring-1 ring-cyan-500/50' 
                                    : 'border-slate-700 bg-[#1e293b]/50 hover:border-slate-600'
                                }
                            `}
                        >
                            {isActive && (
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500"></div>
                            )}
                            <div className="mb-3 flex justify-between items-start">
                                <code className={`
                                    px-2 py-1 rounded text-xs font-mono border max-w-full overflow-hidden text-ellipsis whitespace-nowrap
                                    ${isActive ? 'bg-cyan-950 text-cyan-300 border-cyan-800' : 'bg-slate-900 text-slate-500 border-slate-800'}
                                `}>
                                    {step.lineCode}
                                </code>
                                {isActive && <span className="flex h-2 w-2 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                                </span>}
                                
                                {/* Deep Dive Button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeepDive(step.lineCode);
                                    }}
                                    className="ml-2 p-1.5 rounded-full text-slate-500 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
                                    title="Explain this line in detail"
                                >
                                    <BookOpenIcon className="w-4 h-4" />
                                </button>
                            </div>
                            <p className={`text-sm leading-relaxed ${isActive ? 'text-slate-200' : 'text-slate-400'}`}>
                                {step.explanation}
                            </p>
                        </div>
                    );
                })}
             </div>
          </div>

          {/* Deep Dive Modal */}
          {(deepDiveContent || isDeepDiveLoading) && (
             <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in-up">
                 <div className="bg-[#1e293b] border border-slate-600 rounded-2xl p-6 max-w-lg w-full shadow-2xl relative">
                     <button 
                        onClick={() => { setDeepDiveContent(null); setIsDeepDiveLoading(false); }}
                        className="absolute top-4 right-4 text-slate-400 hover:text-white"
                     >
                        ✕
                     </button>
                     
                     <h3 className="text-xl font-bold text-cyan-400 mb-2 flex items-center gap-2">
                        <BookOpenIcon className="w-6 h-6" />
                        Deep Dive
                     </h3>
                     
                     {isDeepDiveLoading ? (
                        <div className="py-10 flex flex-col items-center space-y-4">
                            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-slate-400 text-sm">Analyzing code...</p>
                        </div>
                     ) : (
                        <>
                            <code className="block bg-[#0f172a] p-2 rounded text-xs font-mono text-slate-300 mb-4 border border-slate-700">
                                {deepDiveContent?.title}
                            </code>
                            <div className="prose prose-invert prose-sm max-h-60 overflow-y-auto">
                                <pre className="whitespace-pre-wrap font-sans text-slate-300 text-sm leading-relaxed">
                                    {deepDiveContent?.content}
                                </pre>
                            </div>
                        </>
                     )}
                 </div>
             </div>
          )}

        </main>
      )}

      <style>{`
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 90%; }
        }
        .animate-progress {
          animation: progress 2s ease-out infinite;
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
            animation: fadeInUp 0.6s ease-out forwards;
        }
        @keyframes musicBar {
            0%, 100% { height: 4px; }
            50% { height: 24px; }
        }
        .animate-music-bar {
            animation: musicBar 0.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default App;