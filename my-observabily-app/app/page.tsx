"use client";

import { useState, useRef, useEffect } from "react";
import { runAgent, runRefundAgent } from "@/lib/agent";

interface Message {
  role: "user" | "assistant";
  content: string;
}

enum AppStep {
  WELCOME,
  GROQ_AUTH,
  CHAT_SIMPLE,
  LANGFUSE_AUTH,
  CHAT_OBSERVABLE,
  REFUND_PRACTICE
}

enum PracticeSubStep {
  CUSTOMER_TYPE,
  DAYS,
  REASON,
  EVALUATING,
  FINISHED
}

export default function ChatPage() {
  const [step, setStep] = useState<AppStep>(AppStep.WELCOME);
  const [groqKey, setGroqKey] = useState("");
  const [langfusePublic, setLangfusePublic] = useState("");
  const [langfuseSecret, setLangfuseSecret] = useState("");

  // Cargar llaves de localStorage al inicio
  useEffect(() => {
    const savedGroq = localStorage.getItem("groq_key");
    const savedLfPublic = localStorage.getItem("lf_public");
    const savedLfSecret = localStorage.getItem("lf_secret");
    if (savedGroq) setGroqKey(savedGroq);
    if (savedLfPublic) setLangfusePublic(savedLfPublic);
    if (savedLfSecret) setLangfuseSecret(savedLfSecret);
  }, []);
  
  // Estado para la práctica estructurada
  const [practiceStep, setPracticeStep] = useState<PracticeSubStep>(PracticeSubStep.CUSTOMER_TYPE);
  const [practiceData, setPracticeData] = useState({
    customer_type: "",
    days_since_purchase: 0,
    reason: ""
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("Eres un asistente útil.");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const validateGroqKey = (key: string) => {
    return key.startsWith("gsk_") && key.length > 20;
  };

  const handleStart = () => {
    setStep(AppStep.GROQ_AUTH);
  };

  const handleRefundPractice = () => {
    if (!groqKey || !langfusePublic || !langfuseSecret) {
      setStep(AppStep.GROQ_AUTH);
    } else {
      startRefundPractice();
    }
  };

  const startRefundPractice = () => {
    setStep(AppStep.REFUND_PRACTICE);
    setPracticeStep(PracticeSubStep.CUSTOMER_TYPE);
    setPracticeData({ customer_type: "", days_since_purchase: 0, reason: "" });
    setMessages([
      { 
        role: "assistant", 
        content: "Bienvenido al servicio al cliente de AliExpress. Soy Ayi y te ayudaré con tu reembolso.\n\nPara empezar, ¿qué tipo de cliente eres?" 
      }
    ]);
    setInput("");
    setIsLoading(false);
  };

  const handlePracticeAction = async (value: string) => {
    if (isLoading) return;

    if (practiceStep === PracticeSubStep.CUSTOMER_TYPE) {
      setMessages(prev => [...prev, { role: "user", content: `Soy cliente ${value}` }]);
      setPracticeData(prev => ({ ...prev, customer_type: value }));
      setPracticeStep(PracticeSubStep.DAYS);
      setMessages(prev => [...prev, { role: "assistant", content: "Entendido. ¿Hace cuántos días realizaste tu pedido? (Por favor, ingresa solo el número)" }]);
      return;
    }

    if (practiceStep === PracticeSubStep.DAYS) {
      const days = parseInt(value);
      if (isNaN(days) || days < 0) {
        setMessages(prev => [...prev, { role: "assistant", content: "Por favor, ingresa un número válido de días (0 o más)." }]);
        return;
      }
      setMessages(prev => [...prev, { role: "user", content: `${days} días` }]);
      setPracticeData(prev => ({ ...prev, days_since_purchase: days }));
      setPracticeStep(PracticeSubStep.REASON);
      setMessages(prev => [...prev, { role: "assistant", content: "Perfecto. Por último, ¿cuál es el motivo de tu solicitud de reembolso?" }]);
      setInput("");
      return;
    }

    if (practiceStep === PracticeSubStep.REASON) {
      setMessages(prev => [...prev, { role: "user", content: value }]);
      setPracticeStep(PracticeSubStep.EVALUATING);
      setIsLoading(true);
      
      const currentData = { ...practiceData, reason: value };
      
      try {
        setMessages(prev => [...prev, { role: "assistant", content: "Analizando tu caso con nuestras políticas de reembolso... Un momento por favor." }]);
        
        const response = await runRefundAgent(groqKey, { publicKey: langfusePublic, secretKey: langfuseSecret }, currentData);
        
        setMessages(prev => [...prev, { role: "assistant", content: response }]);
        setPracticeStep(PracticeSubStep.FINISHED);
      } catch (err) {
        setMessages(prev => [...prev, { role: "assistant", content: "Hubo un problema al procesar la decisión. Asegúrate de que el prompt 'refund_bot' esté en Langfuse." }]);
      } finally {
        setIsLoading(false);
      }
      setInput("");
    }
  };

  const handleGroqSubmit = () => {
    if (validateGroqKey(groqKey)) {
      localStorage.setItem("groq_key", groqKey);
      setStep(AppStep.CHAT_SIMPLE);
      setError("");
    } else {
      setError("Formato de API Key de Groq inválido. Debe comenzar con 'gsk_'.");
    }
  };

  const handleEnableObservability = () => {
    setStep(AppStep.LANGFUSE_AUTH);
  };

  const handleLangfuseSubmit = () => {
    if (langfusePublic.trim() && langfuseSecret.trim()) {
      localStorage.setItem("lf_public", langfusePublic);
      localStorage.setItem("lf_secret", langfuseSecret);
      setStep(AppStep.CHAT_OBSERVABLE);
      setError("");
    } else {
      setError("Por favor, ingresa ambas llaves de Langfuse.");
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    if (step === AppStep.REFUND_PRACTICE) {
      handlePracticeAction(input);
      return;
    }

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const langfuseKeys = step === AppStep.CHAT_OBSERVABLE 
        ? { publicKey: langfusePublic, secretKey: langfuseSecret } 
        : undefined;

      const response = await runAgent(input, groqKey, langfuseKeys, systemPrompt);
      const assistantMessage: Message = { role: "assistant", content: response };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Lo siento, hubo un error al procesar tu solicitud. Verifica tu API Key." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (step === AppStep.WELCOME) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black p-6 text-center">
        <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-blue-500/20 rotate-3">
            <span className="text-5xl">🕵️‍♂️</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
            Guía de <span className="text-blue-600">Observabilidad</span>
          </h1>
          <p className="text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Aprende a monitorear, rastrear y optimizar tus agentes de IA en tiempo real. 
            Comienza por configurar tu modelo y luego añade superpoderes de observabilidad.
          </p>
          <button
            onClick={handleStart}
            className="px-8 py-4 bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 rounded-2xl font-bold text-lg hover:scale-105 transition-transform shadow-xl active:scale-95"
          >
            Iniciar Guía
          </button>
        </div>
      </div>
    );
  }

  if (step === AppStep.GROQ_AUTH) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-black p-6">
        <div className="w-full max-w-md space-y-6 bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Configura Groq</h2>
            <p className="text-sm text-zinc-500">Necesitamos una API Key de Groq para ejecutar el LLM.</p>
          </div>
          <div className="space-y-4">
            <input
              type="password"
              placeholder="gsk_..."
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              className="w-full p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <div className="flex gap-3">
                <button
                onClick={() => setStep(AppStep.WELCOME)}
                className="flex-1 py-4 bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl font-bold hover:opacity-80 transition-opacity"
                >
                Volver
                </button>
                <button
                onClick={handleGroqSubmit}
                className="flex-[2] py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
                >
                Continuar
                </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === AppStep.LANGFUSE_AUTH) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-black p-6">
        <div className="w-full max-w-md space-y-6 bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Activar Observabilidad</h2>
            <p className="text-sm text-zinc-500">Ingresa tus credenciales de Langfuse.</p>
          </div>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Public Key (pk-lf-...)"
              value={langfusePublic}
              onChange={(e) => setLangfusePublic(e.target.value)}
              className="w-full p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <input
              type="password"
              placeholder="Secret Key (sk-lf-...)"
              value={langfuseSecret}
              onChange={(e) => setLangfuseSecret(e.target.value)}
              className="w-full p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(AppStep.CHAT_SIMPLE)}
                className="flex-1 py-4 bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl font-bold hover:opacity-80 transition-opacity"
              >
                Volver
              </button>
              <button
                onClick={handleLangfuseSubmit}
                className="flex-[2] py-4 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-colors"
              >
                Vincular Langfuse
              </button>
            </div>
            <div className="text-center">
              <a 
                href="http://localhost:3000" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                No he configurado Langfuse
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === AppStep.REFUND_PRACTICE) {
    return (
      <div className="flex flex-col h-screen bg-white font-sans text-zinc-900">
        {/* AliExpress Premium Header */}
        <header className="bg-white border-b border-zinc-100 p-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
          <div className="flex items-center gap-4">
             <div className="w-auto h-8 bg-[#FF4747] rounded-lg px-3 flex items-center justify-center">
                <span className="text-white font-black italic tracking-tighter text-xl">AliExpress</span>
             </div>
             <div className="h-6 w-[1px] bg-zinc-200"></div>
             <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-orange-50 p-1 border border-orange-100">
                   <img src="/ayi.png" alt="Ayi" className="w-full h-full object-contain" />
                </div>
                <div>
                   <h2 className="text-sm font-bold leading-none">Ayi Assistant</h2>
                   <p className="text-[10px] text-zinc-400">Servicio al Cliente Premium</p>
                </div>
             </div>
          </div>
          <button 
            onClick={() => setStep(AppStep.CHAT_OBSERVABLE)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
               <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </header>

        {/* Messaging Area */}
        <div className="flex-1 overflow-y-auto bg-zinc-50/30">
          <div className="max-w-2xl mx-auto p-4 space-y-6">
            <div className="text-center">
               <span className="text-[10px] bg-zinc-100 text-zinc-400 py-1 px-3 rounded-full font-medium">CHAT DE REEMBOLSOS</span>
            </div>

            {messages.map((msg, i) => {
              const isApproved = msg.role === "assistant" && (/APPROVE|reembolso aceptado|se aprueba|reembolso aprobado/i.test(msg.content));
              const isDenied = msg.role === "assistant" && (/DENY|reembolso rechazado|rechazar el reembolso|reembolso denegado|debe ser rechazado/i.test(msg.content));
              
              // Limpiar el contenido si hay una decisión para evitar redundancia
              let displayContent = msg.content;
              if (isApproved || isDenied) {
                displayContent = displayContent
                  .replace(/\*\*Decisi[óo]n:.*?\*\*/gi, "")
                  .replace(/Decisi[óo]n:.*?\n/gi, "")
                  .replace(/APPROVE|DENY/gi, "")
                  .trim();
              }

              return (
                <div
                  key={i}
                  className={`flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 ${
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden border ${
                    msg.role === "user" ? "bg-white border-zinc-200" : "bg-orange-50 border-orange-100"
                  }`}>
                    {msg.role === "assistant" ? (
                      <img src="/ayi.png" alt="Ayi" className="w-10 h-10 object-contain" />
                    ) : (
                      <div className="bg-gradient-to-br from-zinc-400 to-zinc-600 w-full h-full flex items-center justify-center text-white text-xs font-bold">U</div>
                    )}
                  </div>
                  
                  <div className={`flex flex-col gap-1 max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    <div
                      className={`rounded-2xl p-4 text-sm shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${
                        msg.role === "user"
                          ? "bg-zinc-900 text-white rounded-tr-none"
                          : "bg-white text-zinc-800 rounded-tl-none border border-zinc-100"
                      }`}
                    >
                      {/* Decision Badges at the TOP */}
                      {isApproved && (
                          <div className="mb-3 flex items-center gap-2 bg-green-50 text-green-700 px-3 py-2 rounded-xl border border-green-100 font-bold text-xs uppercase tracking-tight">
                              <span className="w-5 h-5 bg-green-500 text-white rounded-full flex items-center justify-center text-[10px]">✓</span>
                              Reembolso Aprobado
                          </div>
                      )}
                      {isDenied && (
                          <div className="mb-3 flex items-center gap-2 bg-red-50 text-red-700 px-3 py-2 rounded-xl border border-red-100 font-bold text-xs uppercase tracking-tight">
                              <span className="w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px]">✕</span>
                              Reembolso Denegado
                          </div>
                      )}

                      <p className="whitespace-pre-wrap leading-relaxed">
                        {displayContent}
                      </p>
                    </div>
                    <span className="text-[10px] text-zinc-400 px-1">
                      {msg.role === "assistant" ? "Ayi" : "Tú"} • Ahora
                    </span>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-50 border border-orange-100 p-1">
                   <img src="/ayi.png" alt="Ayi" className="w-full h-full object-contain" />
                </div>
                <div className="bg-white border border-zinc-100 rounded-2xl rounded-tl-none p-4 shadow-sm">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="w-1.5 h-1.5 bg-[#FF4747] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}></span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Opciones Interactivas */}
            {!isLoading && practiceStep === PracticeSubStep.CUSTOMER_TYPE && (
              <div className="flex justify-center gap-4 py-2 animate-in fade-in slide-in-from-bottom-2">
                <button 
                  onClick={() => handlePracticeAction("normal")}
                  className="px-6 py-3 bg-white border-2 border-zinc-200 rounded-2xl text-sm font-bold hover:border-[#FF4747] hover:text-[#FF4747] transition-all"
                >
                  👤 Normal
                </button>
                <button 
                  onClick={() => handlePracticeAction("vip")}
                  className="px-6 py-3 bg-zinc-900 text-white rounded-2xl text-sm font-bold hover:bg-[#FF4747] transition-all"
                >
                  👑 VIP
                </button>
              </div>
            )}

            {practiceStep === PracticeSubStep.FINISHED && (
                <div className="flex justify-center py-4">
                    <button 
                        onClick={startRefundPractice}
                        className="px-6 py-2 bg-[#FF4747] text-white rounded-full text-xs font-bold hover:opacity-90 transition-opacity"
                    >
                        🔄 Reiniciar Práctica
                    </button>
                </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-6 bg-white border-t border-zinc-100">
           <div className="max-w-2xl mx-auto flex items-center gap-3">
              <input
                type={practiceStep === PracticeSubStep.DAYS ? "number" : "text"}
                min={practiceStep === PracticeSubStep.DAYS ? "0" : undefined}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={
                    practiceStep === PracticeSubStep.DAYS ? "Escribe un número..." :
                    practiceStep === PracticeSubStep.REASON ? "Describe el motivo..." :
                    "Responde a Ayi..."
                }
                disabled={isLoading || practiceStep === PracticeSubStep.CUSTOMER_TYPE || practiceStep === PracticeSubStep.FINISHED}
                className="flex-1 bg-zinc-100 rounded-2xl py-3 px-5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 transition-all disabled:opacity-50"
              />
              <button 
                onClick={handleSend}
                disabled={isLoading || !input.trim() || practiceStep === PracticeSubStep.CUSTOMER_TYPE || practiceStep === PracticeSubStep.FINISHED}
                className="w-12 h-12 bg-[#FF4747] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/20 disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
              >
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                </svg>
              </button>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-black font-sans text-zinc-900 dark:text-zinc-100">
      {/* Sidebar */}
      <aside className="w-80 border-r border-zinc-200 dark:border-zinc-800 p-6 flex flex-col gap-6 bg-white dark:bg-zinc-950 overflow-y-auto hidden md:flex">
        <div className="space-y-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span>⚙️</span> Configuración
          </h2>
          <div>
            <label className="block text-sm font-medium mb-2 opacity-70">Prompt Base (System)</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full min-h-[150px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm"
            />
          </div>

          {step === AppStep.CHAT_SIMPLE ? (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl space-y-3">
              <h3 className="font-bold text-blue-800 dark:text-blue-300 text-sm">¿Sin rastreo?</h3>
              <p className="text-xs text-blue-700 dark:text-blue-400">Actualmente el LLM responde pero no sabemos qué está pasando por dentro.</p>
              <button
                onClick={() => setStep(AppStep.LANGFUSE_AUTH)}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
              >
                Iniciar Observabilidad
              </button>
            </div>
          ) : (
             <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-2xl space-y-3">
              <div className="flex items-center gap-2">
                <img src="/langfuse.png" alt="Langfuse" className="w-5 h-5" />
                <h3 className="font-bold text-green-800 dark:text-green-300 text-sm">Observabilidad Activa</h3>
              </div>
              <p className="text-xs text-green-700 dark:text-green-400">Tus trazas se están enviando a Langfuse Local.</p>
              <a
                href="http://localhost:3000"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity"
              >
                <img src="/langfuse.png" alt="Langfuse" className="w-4 h-4" />
                Ir a Langfuse
              </a>
              <div className="pt-4 border-t border-green-100 dark:border-green-900">
                <button
                  onClick={startRefundPractice}
                  className="w-full py-3 bg-[#FF4747] text-white rounded-xl text-sm font-bold hover:bg-[#e63e3e] transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <span>🛍️</span> Iniciar Práctica Reembolsos
                </button>
                <p className="text-[10px] text-center mt-2 opacity-50">Prueba un flujo real con Prompts gestionados.</p>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-16 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full animate-pulse ${step === AppStep.CHAT_OBSERVABLE ? 'bg-green-500' : 'bg-blue-500'}`}></span>
            Chat {step === AppStep.CHAT_OBSERVABLE ? "con Observabilidad" : "Simple"}
          </h1>
          {step === AppStep.CHAT_OBSERVABLE && (
            <div className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold rounded-full border border-green-200 dark:border-green-800">
              TRACING ON
            </div>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50 space-y-4">
              <div className="text-6xl">{step === AppStep.CHAT_OBSERVABLE ? "🚀" : "💬"}</div>
              <p className="text-lg">¡Todo listo! Hazle una pregunta al agente.</p>
              <p className="text-sm max-w-xs">
                {step === AppStep.CHAT_OBSERVABLE 
                  ? "Las trazas aparecerán mágicamente en tu dashboard de Langfuse." 
                  : "Por ahora, este chat no tiene visibilidad interna."}
              </p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-br-none"
                      : "bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-bl-none"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed text-sm">
                    {msg.content}
                  </p>
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl rounded-bl-none p-4 shadow-sm">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full animate-bounce"></span>
                  <span className="w-2 h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2 h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-8 pt-2 bg-zinc-50 dark:bg-black">
          <div className="max-w-4xl mx-auto relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Escribe un mensaje..."
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-4 pl-6 pr-14 shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all sm:text-sm"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className={`absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-md ${
                step === AppStep.CHAT_OBSERVABLE 
                ? 'bg-green-600 hover:bg-green-700' 
                : 'bg-blue-600 hover:bg-blue-700'
              } text-white disabled:bg-zinc-400 dark:disabled:bg-zinc-700`}
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className="w-5 h-5"
              >
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
          <p className="text-center text-[10px] mt-4 opacity-40 uppercase tracking-widest font-bold">
            Guía Narrativa de Observabilidad • Langfuse + Groq
          </p>
        </div>
      </main>
    </div>
  );
}
