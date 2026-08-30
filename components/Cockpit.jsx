'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlaneTakeoff, Key, Brain, Database, LineChart, FileText, Send, Loader2, AlertCircle, CheckCircle2, Menu, X, ChevronRight, Zap, Pencil, Square, Mic, Trash2, Download, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import html2pdf from 'html2pdf.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Framer Motion Variants
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

const CHART_COLORS = ['#8b5cf6', '#22d3ee', '#f59e0b', '#10b981', '#ef4444'];

export default function Cockpit() {
  const [activeTab, setActiveTab] = useState('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [useLiveMonday, setUseLiveMonday] = useState(true);
  const [mondayToken, setMondayToken] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', message: '' }); 
  const [dashboardMetrics, setDashboardMetrics] = useState(null);
  const [reportOutput, setReportOutput] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [selectedSector, setSelectedSector] = useState('');
  
  // Board Mapping State
  const [availableBoards, setAvailableBoards] = useState([]);
  const [selectedDealsBoard, setSelectedDealsBoard] = useState('');
  const [selectedWoBoard, setSelectedWoBoard] = useState('');
  
  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const chatEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  
  // Ref for PDF target
  const reportRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem('lumina_chat');
    if (saved) {
      try {
        setChatMessages(JSON.parse(saved));
      } catch (e) {
        setChatMessages([{ role: 'agent', text: 'Welcome, Founder. I am synced with your sales pipeline and execution records. How can I assist you with your business analysis today?' }]);
      }
    } else {
      setChatMessages([{ role: 'agent', text: 'Welcome, Founder. I am synced with your sales pipeline and execution records. How can I assist you with your business analysis today?' }]);
    }
  }, []);

  useEffect(() => {
    if (chatMessages.length > 0 && !isTyping) {
      localStorage.setItem('lumina_chat', JSON.stringify(chatMessages));
    }
  }, [chatMessages, isTyping]);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsTyping(false);
    }
  };

  const clearChat = () => {
    const defaultMsg = [{ role: 'agent', text: 'Welcome, Founder. I am synced with your sales pipeline and execution records. How can I assist you with your business analysis today?' }];
    setChatMessages(defaultMsg);
    localStorage.setItem('lumina_chat', JSON.stringify(defaultMsg));
  };

  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setChatInput(prev => prev + (prev ? ' ' : '') + transcript);
    };
    recognition.onerror = (event) => console.error('Speech recognition error', event.error);
    recognition.onend = () => setIsListening(false);
    
    recognition.start();
  };

  // Load saved tokens and boards
  useEffect(() => {
    setMondayToken(localStorage.getItem('mondayToken') || '');
    localStorage.removeItem('geminiKey'); // Clear any old stuck keys
    setSelectedDealsBoard(localStorage.getItem('selectedDealsBoard') || '');
    setSelectedWoBoard(localStorage.getItem('selectedWoBoard') || '');
  }, []);

  useEffect(() => {
    fetchDashboardMetrics();
  }, [useLiveMonday, selectedDealsBoard, selectedWoBoard]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isTyping]);

  const saveToken = (type, val) => {
    if (type === 'monday') { setMondayToken(val); localStorage.setItem('mondayToken', val); }
  };

  const handleSync = async () => {
    if (!mondayToken) {
      setSyncStatus({ state: 'error', message: 'Monday API Token is required.' });
      return;
    }
    setSyncStatus({ state: 'loading', message: 'Syncing to Monday.com...' });
    try {
      const res = await fetch('/api/monday/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mondayToken })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncStatus({ state: 'success', message: 'Successfully synced with Monday.com!' });
      setTimeout(() => setSyncStatus({ state: 'idle', message: '' }), 5000);
      setUseLiveMonday(true);
    } catch (err) {
      setSyncStatus({ state: 'error', message: err.message });
      setTimeout(() => setSyncStatus({ state: 'idle', message: '' }), 5000);
    }
  };

  const fetchDashboardMetrics = async () => {
    try {
      const res = await fetch('/api/data/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mondayToken, 
          useLiveMonday,
          dealsBoardId: selectedDealsBoard,
          woBoardId: selectedWoBoard 
        })
      });
      const data = await res.json();
      if (data.metrics) setDashboardMetrics(data.metrics);
    } catch (err) {
      console.error('Failed to fetch dashboard metrics:', err);
    }
  };

  const checkConnection = async () => {
    if (!mondayToken) return;
    setSyncStatus({ state: 'loading', message: 'Fetching your boards...' });
    try {
      const res = await fetch('/api/monday/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mondayToken })
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (data.boards) {
        setAvailableBoards(data.boards);
        
        // Auto-select if they match expected names or uploaded files
        const d = data.boards.find(b => b.name.toLowerCase().includes('deal'));
        const w = data.boards.find(b => b.name.toLowerCase().includes('work') || b.name.toLowerCase().includes('order'));
        if (d) setSelectedDealsBoard(d.id);
        if (w) setSelectedWoBoard(w.id);
        
        setSyncStatus({ state: 'success', message: 'Connected! Please select your boards.' });
        setTimeout(() => setSyncStatus({ state: 'idle', message: '' }), 3000);
      } else {
        throw new Error('No boards found.');
      }
    } catch (err) {
      setSyncStatus({ state: 'error', message: 'Failed to fetch boards.' });
      setTimeout(() => setSyncStatus({ state: 'idle', message: '' }), 3000);
    }
  };

  const handleSendMessage = async (customQuery = null) => {
    const query = customQuery || chatInput;
    if (!query.trim()) return;
    
    if (!customQuery) setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: query }]);
    setIsTyping(true);
    
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: query, 
          mondayToken, 
          useLiveMonday,
          dealsBoardId: selectedDealsBoard,
          woBoardId: selectedWoBoard
        }),
        signal: abortControllerRef.current.signal
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let streamedText = '';
      
      setChatMessages(prev => [...prev, { role: 'agent', text: '', isStreaming: true }]);

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunkStr = decoder.decode(value, { stream: true });
          const lines = chunkStr.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'text') {
                streamedText += data.content;
                setChatMessages(prev => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1].text = streamedText;
                  return newMsgs;
                });
              } else if (data.type === 'chart') {
                setChatMessages(prev => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1].chartData = data.data;
                  newMsgs[newMsgs.length - 1].chartType = data.chartType;
                  return newMsgs;
                });
              } else if (data.type === 'done') {
                setChatMessages(prev => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1].isStreaming = false;
                  return newMsgs;
                });
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (e) {
              console.error("Parse error on chunk line:", line, e);
            }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setChatMessages(prev => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1].isStreaming = false;
          newMsgs[newMsgs.length - 1].text += '\n\n*(Generation stopped)*';
          return newMsgs;
        });
      } else {
        setChatMessages(prev => [...prev, { role: 'agent', text: `Error: ${err.message}` }]);
      }
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const handleGenerateReport = async () => {
    setIsGeneratingReport(true);
    setReportOutput('Generating AI analysis...');
    
    try {
      const res = await fetch('/api/leadership-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quarter: 'Q1',
          sector: selectedSector,
          mondayToken,
          geminiKey,
          useLiveMonday,
          dealsBoardId: selectedDealsBoard,
          woBoardId: selectedWoBoard
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setReportOutput(data.report);
    } catch (err) {
      setReportOutput(`Error generating report: ${err.message}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <div className="flex h-screen w-full relative font-sans text-gray-200">
      
      {/* Toast Notification for Sync */}
      <AnimatePresence>
        {syncStatus.state !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 20, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl glass-panel ${syncStatus.state === 'error' ? 'border-red-500/50' : 'border-teal-500/50'}`}
          >
            {syncStatus.state === 'loading' && <Loader2 className="animate-spin text-teal-400" size={20} />}
            {syncStatus.state === 'success' && <CheckCircle2 className="text-teal-400" size={20} />}
            {syncStatus.state === 'error' && <AlertCircle className="text-red-400" size={20} />}
            <span className="font-medium text-sm">{syncStatus.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        animate={{ width: sidebarOpen ? 320 : 0 }}
        className="h-full glass-panel border-r border-white/5 flex flex-col overflow-hidden shrink-0 z-20"
      >
        <div className="p-6 w-[320px]">
          <div className="flex items-center gap-4 mb-10">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-violet to-accent-teal flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.4)]">
              <PlaneTakeoff className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gradient">LUMINA</h1>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-widest">Analytics</p>
            </div>
          </div>

          <div className="space-y-8">
            {/* Mode Switcher */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Connection Mode</h3>
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                <button 
                  onClick={() => setUseLiveMonday(false)}
                  className={`flex-1 text-sm py-2 rounded-lg font-medium transition-all ${!useLiveMonday ? 'bg-white/10 shadow-lg text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Demo Mode
                </button>
                <button 
                  onClick={() => setUseLiveMonday(true)}
                  className={`flex-1 text-sm py-2 rounded-lg font-medium transition-all ${useLiveMonday ? 'bg-gradient-to-r from-accent-violet/20 to-accent-teal/20 border border-accent-teal/30 shadow-[0_0_15px_rgba(34,211,238,0.2)] text-accent-teal' : 'text-gray-400 hover:text-white'}`}
                >
                  Live Monday
                </button>
              </div>
            </div>

            {/* Config Panel */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Database size={14}/> Monday.com Token
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input 
                    type="password"
                    value={mondayToken}
                    onChange={(e) => saveToken('monday', e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-teal focus:ring-1 focus:ring-accent-teal transition-all placeholder-gray-600"
                    placeholder="Paste API Token..."
                  />
                </div>
                <button onClick={checkConnection} className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all">
                  Fetch My Boards
                </button>
                
                {availableBoards.length > 0 && (
                  <div className="pt-2 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Deals Board</label>
                      <select 
                        className="w-full bg-[#1A1F2B] border border-gray-700/50 rounded-lg p-2.5 text-sm text-gray-200 focus:ring-1 focus:ring-violet-500 outline-none"
                        value={selectedDealsBoard}
                        onChange={(e) => {
                          setSelectedDealsBoard(e.target.value);
                          localStorage.setItem('selectedDealsBoard', e.target.value);
                        }}
                      >
                        <option value="">Select a board...</option>
                        {availableBoards.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Work Orders Board</label>
                      <select 
                        className="w-full bg-[#1A1F2B] border border-gray-700/50 rounded-lg p-2.5 text-sm text-gray-200 focus:ring-1 focus:ring-violet-500 outline-none"
                        value={selectedWoBoard}
                        onChange={(e) => {
                          setSelectedWoBoard(e.target.value);
                          localStorage.setItem('selectedWoBoard', e.target.value);
                        }}
                      >
                        <option value="">Select a board...</option>
                        {availableBoards.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    <button 
                      onClick={handleSync}
                      className="w-full py-2.5 px-4 bg-gray-800/50 hover:bg-gray-800 text-gray-300 text-sm font-medium rounded-lg border border-gray-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <Database size={16} /> Sync Excel (Optional)
                    </button>
                  </div>
                )}
              </div>

            </div>

            {/* Data Quality Gauge */}
            <div className="space-y-3">
               <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Data Resilience</h3>
               <div className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                 <div className="relative w-16 h-16 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-white/10" />
                      <motion.circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6" fill="transparent" 
                        initial={{ strokeDasharray: '0 1000' }}
                        animate={{ strokeDasharray: `${dashboardMetrics ? 85 : 49} 1000` }}
                        transition={{ duration: 1.5, ease: 'easeOut' }}
                        className="text-accent-teal" 
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute font-bold text-lg">{dashboardMetrics ? '85' : '49'}</span>
                 </div>
                 <div>
                   <p className="font-medium text-sm">Board Integrity</p>
                   <p className="text-xs text-gray-400 mt-0.5">Needs Cleaning</p>
                 </div>
               </div>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full relative">
        
        {/* Floating Sticky Nav */}
        <header className="sticky top-0 z-30 backdrop-blur-xl bg-base/50 border-b border-white/5 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <Menu size={20} />
            </button>
            
            <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10">
              {['chat', 'dashboard', 'reports'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="relative px-6 py-2 text-sm font-medium rounded-full transition-colors"
                >
                  {activeTab === tab && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.1)] rounded-full border border-white/20"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className={`relative z-10 flex items-center gap-2 ${activeTab === tab ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                    {tab === 'chat' && <Brain size={16} />}
                    {tab === 'dashboard' && <LineChart size={16} />}
                    {tab === 'reports' && <FileText size={16} />}
                    <span className="capitalize">{tab}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5">
                <div className={`w-2 h-2 rounded-full animate-pulse ${useLiveMonday ? 'bg-accent-teal shadow-[0_0_8px_#22d3ee]' : 'bg-gray-500'}`} />
                <span className="text-xs font-medium text-gray-300">{useLiveMonday ? 'Live Connection Active' : 'Local Data Mode'}</span>
             </div>
          </div>
        </header>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-6">
          <AnimatePresence mode="wait">
            
            {activeTab === 'chat' && (
              <motion.div
                key="chat"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl mx-auto h-full flex flex-col"
              >
                <div className="flex-1 overflow-y-auto no-scrollbar space-y-6 pb-6">
                  {chatMessages.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial="hidden"
                      animate="visible"
                      variants={fadeUp}
                      transition={{ delay: i * 0.1 }}
                      className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center shadow-lg ${msg.role === 'agent' ? 'bg-gradient-to-br from-accent-violet to-accent-teal border border-accent-teal/30' : 'bg-white/10 border border-white/20'}`}>
                          {msg.role === 'agent' ? <Brain size={20} className="text-white" /> : <div className="text-sm font-bold">U</div>}
                        </div>
                        {msg.role === 'user' && !isTyping && (
                          <button 
                            onClick={() => {
                              setChatInput(msg.text);
                              setChatMessages(prev => prev.slice(0, i));
                            }}
                            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            title="Edit and Re-ask"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                      
                      <div className={`max-w-[80%] glass-panel rounded-2xl p-5 ${msg.role === 'user' ? 'bg-white/10' : 'bg-surface/80'}`}>
                        <div className="prose prose-invert prose-sm max-w-none text-gray-300 leading-relaxed whitespace-pre-wrap">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                        </div>
                        
                        {/* Dynamic Chart Rendering inside Chat */}
                        {msg.chartData && (
                          <div className="mt-6 h-64 border-t border-white/10 pt-6">
                            <ResponsiveContainer width="100%" height="100%">
                              {msg.chartType === 'pie' ? (
                                <PieChart>
                                  <Pie 
                                    data={msg.chartData.datasets[0].data.map((val, i) => ({ name: msg.chartData.labels[i], value: val }))} 
                                    dataKey="value" innerRadius={60} outerRadius={80} stroke="none"
                                    onClick={(data) => handleSendMessage(`Tell me more about the ${data.name} status`)}
                                    className="cursor-pointer hover:opacity-80 transition-opacity"
                                  >
                                    {msg.chartData.datasets[0].data.map((_, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                                  </Pie>
                                  <Tooltip contentStyle={{ backgroundColor: '#14181f', borderColor: '#ffffff1a', borderRadius: '12px' }} />
                                  <Legend />
                                </PieChart>
                              ) : (
                                <BarChart data={msg.chartData.labels.map((lbl, i) => ({ name: lbl, value: msg.chartData.datasets[0].data[i] }))}>
                                  <XAxis dataKey="name" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#14181f', borderColor: '#ffffff1a', borderRadius: '12px' }} />
                                  <Bar 
                                    dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]}
                                    onClick={(data) => handleSendMessage(`Tell me more about the ${data.name} metric`)}
                                    className="cursor-pointer hover:opacity-80 transition-opacity"
                                  />
                                </BarChart>
                              )}
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  
                  {isTyping && chatMessages[chatMessages.length - 1]?.role === 'user' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
                       <div className="w-10 h-10 rounded-xl shrink-0 bg-gradient-to-br from-accent-violet to-accent-teal flex items-center justify-center opacity-70">
                         <Loader2 className="animate-spin text-white" size={20} />
                       </div>
                       <div className="glass-panel rounded-2xl p-5 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-accent-teal animate-bounce" />
                          <span className="w-2 h-2 rounded-full bg-accent-teal animate-bounce" style={{ animationDelay: '0.2s' }} />
                          <span className="w-2 h-2 rounded-full bg-accent-teal animate-bounce" style={{ animationDelay: '0.4s' }} />
                       </div>
                    </motion.div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Quick Templates */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {[
                    { icon: Zap, label: "Energy pipeline this Q" },
                    { icon: Database, label: "Accounts Receivable (AR)" },
                    { icon: LineChart, label: "Mining Sector Overview" }
                  ].map((chip, i) => (
                    <button 
                      key={i}
                      onClick={() => handleSendMessage(chip.label)}
                      className="glass-panel-hover flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-gray-300 border border-white/10 bg-white/5"
                    >
                      <chip.icon size={14} className="text-accent-teal" />
                      {chip.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 items-center">
                  <button 
                    onClick={clearChat}
                    title="Clear Chat History"
                    className="p-3 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-2xl transition-all border border-white/10"
                  >
                    <Trash2 size={18} />
                  </button>
                  <div className="relative flex items-center flex-1">
                    <input 
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Ask about revenue, pipeline, operational billing..."
                      className="w-full bg-surface-glass backdrop-blur-xl border border-white/20 rounded-2xl py-4 pl-12 pr-16 text-sm focus:outline-none focus:border-accent-teal focus:ring-1 focus:ring-accent-teal shadow-2xl placeholder-gray-500"
                    />
                    
                    <button
                      onClick={handleVoiceInput}
                      className={`absolute left-3 p-1.5 rounded-lg transition-all ${isListening ? 'text-red-400 bg-red-400/20 animate-pulse' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                      title="Dictate Message"
                    >
                      <Mic size={18} />
                    </button>
                    
                    {isTyping ? (
                      <button 
                        onClick={stopGeneration}
                        className="absolute right-2 p-2.5 bg-red-500 hover:bg-red-600 text-white text-base rounded-xl transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                        title="Stop Generating"
                      >
                        <Square size={18} fill="currentColor" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleSendMessage()}
                        disabled={!chatInput.trim()}
                        className="absolute right-2 p-2.5 bg-accent-teal hover:bg-accent-teal/80 text-base rounded-xl transition-all disabled:opacity-50"
                      >
                        <Send size={18} className="text-surface" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'dashboard' && dashboardMetrics && (
              <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                
                <div className="flex items-center justify-between">
                   <h2 className="text-2xl font-bold text-white">Pipeline Analytics</h2>
                   <button 
                     onClick={() => {
                        setDashboardMetrics(null);
                        fetchDashboardMetrics();
                     }}
                     className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm font-medium transition-colors border border-white/10"
                   >
                     <RefreshCw size={14} className="text-accent-teal" /> Live Refresh
                   </button>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Contract Value', value: `₹${(dashboardMetrics.revenue.totalWOAmountExcl / 1000000).toFixed(2)}M`, color: 'text-accent-teal', bg: 'bg-accent-teal/10' },
                    { label: 'Billed Value', value: `₹${(dashboardMetrics.revenue.totalBilledValueExcl / 1000000).toFixed(2)}M`, color: 'text-accent-violet', bg: 'bg-accent-violet/10' },
                    { label: 'Cash Collected', value: `₹${(dashboardMetrics.revenue.totalCollectedValueIncl / 1000000).toFixed(2)}M`, color: 'text-green-400', bg: 'bg-green-400/10' },
                    { label: 'Outstanding AR', value: `₹${(dashboardMetrics.revenue.totalReceivables / 1000000).toFixed(2)}M`, color: 'text-accent-amber', bg: 'bg-accent-amber/10' }
                  ].map((kpi, i) => (
                    <motion.div key={i} variants={fadeUp} initial="hidden" animate="visible" transition={{ delay: i * 0.1 }} className="glass-panel rounded-2xl p-6 relative overflow-hidden">
                      <div className={`w-12 h-12 rounded-full ${kpi.bg} flex items-center justify-center mb-4`}>
                        <Database className={kpi.color} size={20} />
                      </div>
                      <h4 className="text-3xl font-bold tracking-tight text-white mb-1">{kpi.value}</h4>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{kpi.label}</p>
                    </motion.div>
                  ))}
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="glass-panel rounded-2xl p-6 h-80">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-6">Pipeline by Stage</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={Object.entries(dashboardMetrics.pipeline.byStage).map(([name, obj]) => ({ name, val: obj.val }))}>
                        <XAxis dataKey="name" stroke="#4b5563" fontSize={10} tickFormatter={(val) => val.substring(0,10)} />
                        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#14181f', borderColor: '#ffffff1a', borderRadius: '12px' }} />
                        <Bar 
                           dataKey="val" fill="#22d3ee" radius={[4, 4, 0, 0]}
                           onClick={(data) => { setActiveTab('chat'); handleSendMessage(`Deep dive into pipeline stage: ${data.name}`); }}
                           className="cursor-pointer hover:opacity-80 transition-opacity"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="glass-panel rounded-2xl p-6 h-80">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-6">Execution Status</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie 
                          data={Object.entries(dashboardMetrics.workOrders.byStatus).map(([name, value]) => ({ name, value }))} 
                          dataKey="value" innerRadius={70} outerRadius={90} stroke="none" paddingAngle={5}
                          onClick={(data) => { setActiveTab('chat'); handleSendMessage(`Deep dive into execution status: ${data.name}`); }}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                        >
                          {Object.entries(dashboardMetrics.workOrders.byStatus).map((_, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#14181f', borderColor: '#ffffff1a', borderRadius: '12px' }} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

              </motion.div>
            )}

            {activeTab === 'reports' && (
              <motion.div key="reports" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-4xl mx-auto space-y-6">
                <div className="glass-panel rounded-3xl p-8 border border-accent-violet/20 shadow-[0_0_30px_rgba(139,92,246,0.1)]">
                   <h2 className="text-2xl font-bold text-white mb-2">Executive Reports</h2>
                   <p className="text-sm text-gray-400 mb-8">Generate formal leadership updates automatically via AI.</p>
                   
                   <div className="flex gap-4 mb-6">
                      <select 
                        className="bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent-violet w-48 text-white"
                        value={selectedSector}
                        onChange={(e) => setSelectedSector(e.target.value)}
                      >
                        <option value="">All Sectors</option>
                        <option value="Mining">Mining</option>
                        <option value="Renewables">Renewables</option>
                      </select>
                      <button 
                        onClick={handleGenerateReport}
                        disabled={isGeneratingReport}
                        className="flex-1 bg-gradient-to-r from-accent-violet to-accent-teal hover:opacity-90 text-white font-medium py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] disabled:opacity-50"
                      >
                        {isGeneratingReport ? 'Generating...' : 'Generate Update'}
                      </button>
                      
                      {reportOutput && (
                        <button 
                          onClick={() => {
                            if (reportRef.current) {
                              const opt = {
                                margin: 10,
                                filename: 'Lumina_Executive_Report.pdf',
                                image: { type: 'jpeg', quality: 0.98 },
                                html2canvas: { scale: 2, useCORS: true },
                                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                              };
                              html2pdf().set(opt).from(reportRef.current).save();
                            }
                          }}
                          className="px-6 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-all border border-white/10 flex items-center gap-2"
                        >
                          <Download size={18} /> Export PDF
                        </button>
                      )}
                   </div>
                   
                   <div className="bg-surface/50 rounded-xl p-6 border border-white/5 h-64 flex flex-col items-center justify-center text-gray-300 overflow-y-auto">
                     {reportOutput ? (
                       <div ref={reportRef} className="prose prose-invert prose-sm max-w-none w-full text-left whitespace-pre-wrap p-4 bg-[#14181f]">
                         <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportOutput}</ReactMarkdown>
                       </div>
                     ) : (
                       <>
                         <FileText size={48} className="mb-4 opacity-20 text-gray-500" />
                         <p className="text-gray-500">Report output will appear here</p>
                       </>
                     )}
                   </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>

    </div>
  );
}
