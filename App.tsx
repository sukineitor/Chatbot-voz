import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Chat } from '@google/genai';
import { geminiService } from './services/geminiService';
import MenuModal from './components/MenuModal';
import LiveConversationModal from './components/LiveConversationModal';
import type { ChatMessage } from './types';

// SpeechRecognition interfaces for browsers that support it
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: { new(): SpeechRecognition };
    webkitSpeechRecognition: { new(): SpeechRecognition };
  }
}

// Funciones para decodificar el audio de la API
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


const MicIcon: React.FC<{ isListening: boolean }> = ({ isListening }) => (
  <svg className={`w-6 h-6 ${isListening ? 'text-red-500' : 'text-gray-400'}`} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
  </svg>
);

const CallIcon: React.FC = () => (
    <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
        <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.02.74-.25 1.02l-2.2 2.2z"/>
    </svg>
);

const SendIcon: React.FC = () => (
    <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
);

const App: React.FC = () => {
    const [chat, setChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isLiveConversationActive, setIsLiveConversationActive] = useState(false);
    
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        setChat(geminiService.createChat());
        setMessages([{
            id: 'init',
            role: 'model',
            text: '¡Hola! Bienvenido a Sabor Peruano. Soy su asistente virtual. ¿En qué puedo ayudarle hoy? Puedo mostrarle el menú, tomar su reserva o pedido para delivery.'
        }]);
    }, []);
    
    useEffect(() => {
      chatContainerRef.current?.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }, [messages]);

    const playAudio = useCallback(async (base64Audio: string) => {
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            } catch (e) {
                console.error("Web Audio API is not supported in this browser", e);
                return;
            }
        }
        const audioContext = audioContextRef.current;
        try {
            const audioBytes = decode(base64Audio);
            const audioBuffer = await decodeAudioData(audioBytes, audioContext, 24000, 1);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start();
        } catch (error) {
            console.error("Error playing audio:", error);
        }
    }, []);

    const handleSendMessage = useCallback(async (messageText: string) => {
        if (!chat || !messageText.trim()) return;

        const newUserMessage: ChatMessage = { id: Date.now().toString(), role: 'user', text: messageText };
        setMessages(prev => [...prev, newUserMessage]);
        setInput('');
        setIsLoading(true);
        
        let responseText = '';
        let messageId = '';

        try {
            const result = await chat.sendMessage({ message: messageText });
            
            const functionCalls = result.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                if (call.name === 'showMenu') {
                    setIsMenuOpen(true);
                    responseText = 'Claro, aquí tiene nuestra carta.';
                    messageId = 'func-menu';
                } else if (call.name === 'makeReservation') {
                    const { name, numberOfPeople, date, time } = call.args;
                    responseText = `¡Perfecto, ${name}! Tu reserva para ${numberOfPeople} personas el ${date} a las ${time} ha sido confirmada. ¡Les esperamos!`;
                    messageId = 'func-res';
                } else if (call.name === 'placeOrder') {
                     const { items, address } = call.args as {items: string[], address: string};
                    responseText = `¡Entendido! Tu pedido de ${items.join(', ')} está en camino a ${address}. ¡Gracias por elegir Sabor Peruano!`;
                    messageId = 'func-ord';
                }
            } else {
                 responseText = result.text;
                 messageId = 'model-' + Date.now();
            }
             setMessages(prev => [...prev, { id: messageId, role: 'model', text: responseText }]);
        } catch (error) {
            console.error('Error sending message:', error);
            responseText = 'Lo siento, ha ocurrido un error. Por favor, intente de nuevo.';
            messageId = 'err-' + Date.now();
            setMessages(prev => [...prev, { id: messageId, role: 'model', text: responseText }]);
        } finally {
            setIsLoading(false);
            if (responseText) {
              const audioData = await geminiService.generateSpeech(responseText);
              if (audioData) {
                  await playAudio(audioData);
              }
            }
        }
    }, [chat, playAudio]);
    
    const handleVoiceRecognition = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }

        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) {
            alert('Tu navegador no soporta el reconocimiento de voz.');
            return;
        }

        const recognition = new SpeechRecognitionAPI();
        recognition.lang = 'es-ES';
        recognition.interimResults = true;
        recognition.continuous = false;

        recognitionRef.current = recognition;
        
        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join('');
            setInput(transcript);
            if (event.results[0].isFinal) {
                handleSendMessage(transcript);
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };
        
        recognition.onend = () => {
            setIsListening(false);
        };

        recognition.start();
        setIsListening(true);
    };


    return (
        <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-center font-sans p-4" style={{backgroundImage: 'url(https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1920&auto=format&fit=crop)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'}}>
          <div className="absolute inset-0 bg-black opacity-60"></div>
            <div className="w-full max-w-2xl h-[90vh] bg-gray-900 bg-opacity-80 backdrop-blur-sm rounded-2xl shadow-2xl flex flex-col z-10">
                <header className="p-4 border-b border-gray-700 text-center">
                    <h1 className="text-3xl font-serif text-amber-400">Sabor Peruano</h1>
                    <p className="text-gray-400">Asistente Virtual</p>
                </header>

                <div ref={chatContainerRef} className="flex-1 p-6 overflow-y-auto space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-md p-3 rounded-xl ${msg.role === 'user' ? 'bg-amber-600' : 'bg-gray-700'}`}>
                                <p className="text-white whitespace-pre-wrap">{msg.text}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                       <div className="flex justify-start">
                         <div className="max-w-md p-3 rounded-xl bg-gray-700 flex items-center space-x-2">
                           <span className="w-2 h-2 bg-white rounded-full animate-pulse delay-75"></span>
                           <span className="w-2 h-2 bg-white rounded-full animate-pulse delay-150"></span>
                           <span className="w-2 h-2 bg-white rounded-full animate-pulse delay-300"></span>
                         </div>
                       </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-700">
                    <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }} className="flex items-center space-x-3 bg-gray-800 rounded-full p-2">
                        <button type="button" onClick={handleVoiceRecognition} className="p-2 rounded-full hover:bg-gray-700 transition-colors">
                          <MicIcon isListening={isListening} />
                        </button>
                        <button type="button" onClick={() => setIsLiveConversationActive(true)} className="p-2 rounded-full hover:bg-gray-700 transition-colors">
                          <CallIcon />
                        </button>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Escribe, usa el micrófono o llama al asistente..."
                            className="flex-1 bg-transparent focus:outline-none text-white placeholder-gray-500"
                            disabled={isLoading}
                        />
                        <button type="submit" disabled={isLoading || !input.trim()} className="p-2 rounded-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors">
                            <SendIcon />
                        </button>
                    </form>
                </div>
            </div>
            <MenuModal isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
            <LiveConversationModal isOpen={isLiveConversationActive} onClose={() => setIsLiveConversationActive(false)} />
        </div>
    );
};

export default App;