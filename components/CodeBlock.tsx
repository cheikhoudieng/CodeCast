import React, { useEffect, useRef, useState } from 'react';
import { CopyIcon, CheckIcon } from './Icons';

interface CodeBlockProps {
  code: string;
  language: string;
  highlight?: string | null;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, highlight }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (highlight && containerRef.current) {
      const el = containerRef.current.querySelector('.highlight-active');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlight]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const renderCode = () => {
    const lines = code.split('\n');
    return lines.map((line, idx) => {
      const lineNumber = idx + 1;
      let content: React.ReactNode = line;

      // Simple highlight logic
      if (highlight && line.includes(highlight)) {
         const parts = line.split(highlight);
         content = (
           <>
            {parts.map((part, i) => (
              <React.Fragment key={i}>
                {part}
                {i < parts.length - 1 && (
                  <span className="highlight-active bg-yellow-500/20 text-yellow-100 font-bold px-1 -mx-1 rounded border-b-2 border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                    {highlight}
                  </span>
                )}
              </React.Fragment>
            ))}
           </>
         );
      }

      return (
        <div key={idx} className="table-row">
            <span className="table-cell text-right pr-4 select-none text-slate-600 text-xs w-8 align-top py-0.5">
                {lineNumber}
            </span>
            <span className="table-cell align-top py-0.5 whitespace-pre-wrap break-all">
                {content || '\n'}
            </span>
        </div>
      );
    });
  };

  return (
    <div className="relative rounded-lg overflow-hidden bg-[#1e293b] border border-slate-700 shadow-2xl group/code">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0f172a] border-b border-slate-700">
        <div className="flex space-x-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
        </div>
        <div className="flex items-center space-x-3">
             <span className="text-xs font-medium text-slate-400 uppercase">{language}</span>
             <button 
                onClick={handleCopy}
                className="text-slate-400 hover:text-white transition-colors"
                title="Copy code"
             >
                {copied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4" />}
             </button>
        </div>
      </div>
      <div ref={containerRef} className="p-4 overflow-x-auto max-h-[500px] scroll-smooth">
        <pre className="code-font text-sm leading-relaxed text-slate-200 w-full table">
            {renderCode()}
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;