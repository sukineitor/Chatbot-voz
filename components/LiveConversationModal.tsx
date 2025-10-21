import React, { useState, useEffect, useRef, useCallback } from 'react';
import { geminiService } from '../services/geminiService';
import type { LiveServerMessage, Blob } from '@google/genai';

interface LiveConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// --- Audio Utility Functions ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const LiveConversationModal: React.FC<LiveConversationModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState('Iniciando...');
  const [userTranscript, setUserTranscript] = useState('');
  const [modelTranscript, setModelTranscript] = useState('');
  const [conversationHistory, setConversationHistory] = useState<{ speaker: 'user' | 'model', text: string }[]>([]);

  const sessionPromiseRef = useRef<ReturnType<typeof geminiService.startLiveConversation> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const handleClose = useCallback(() => {
    // Cleanup logic is now inside the useEffect return statement
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      let isActive = true;
      setStatus('Solicitando permiso de micrófono...');
      
      const startSession = async () => {
        try {
          // --- Setup ---
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!isActive) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          mediaStreamRef.current = stream;
          
          inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
          outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
          
          let currentInputTranscription = '';
          let currentOutputTranscription = '';

          // --- Connect to Gemini Live API ---
          sessionPromiseRef.current = geminiService.startLiveConversation({
            onopen: () => {
              if (!isActive) return;
              setStatus('Conectado. ¡Habla ahora!');
              const inputAudioContext = inputAudioContextRef.current!;
              
              sourceNodeRef.current = inputAudioContext.createMediaStreamSource(stream);
              audioProcessorNodeRef.current = inputAudioContext.createScriptProcessor(4096, 1, 1);
              
              audioProcessorNodeRef.current.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionPromiseRef.current?.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };

              sourceNodeRef.current.connect(audioProcessorNodeRef.current);
              audioProcessorNodeRef.current.connect(inputAudioContext.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
              if (!isActive) return;
              
              // Handle transcriptions
              if (message.serverContent?.inputTranscription) {
                currentInputTranscription += message.serverContent.inputTranscription.text;
                setUserTranscript(currentInputTranscription);
              }
              if (message.serverContent?.outputTranscription) {
                currentOutputTranscription += message.serverContent.outputTranscription.text;
                setModelTranscript(currentOutputTranscription);
              }

              if(message.serverContent?.turnComplete) {
                if (currentInputTranscription) {
                  setConversationHistory(prev => [...prev, { speaker: 'user', text: currentInputTranscription }]);
                }
                 if (currentOutputTranscription) {
                  setConversationHistory(prev => [...prev, { speaker: 'model', text: currentOutputTranscription }]);
                }
                currentInputTranscription = '';
                currentOutputTranscription = '';
                setUserTranscript('');
                setModelTranscript('');
              }

              // Handle audio playback
              const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (base64Audio) {
                const outputAudioContext = outputAudioContextRef.current!;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
                
                const audioBytes = decode(base64Audio);
                const audioBuffer = await decodeAudioData(audioBytes, outputAudioContext, 24000, 1);
                
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.destination);
                source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                audioSourcesRef.current.add(source);
              }
              
              if (message.serverContent?.interrupted) {
                for (const source of audioSourcesRef.current.values()) {
                  source.stop();
                }
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
              }
            },
            onerror: (e: ErrorEvent) => {
              if (!isActive) return;
              console.error("Live session error:", e);
              setStatus('Error en la conexión. Intenta de nuevo.');
            },
            onclose: (e: CloseEvent) => {
              if (!isActive) return;
              setStatus('Conversación finalizada.');
            },
          });
        } catch (error) {
          console.error("Failed to start live session:", error);
          setStatus('Error: No se pudo acceder al micrófono.');
        }
      };

      startSession();

      // --- Cleanup Function ---
      return () => {
        isActive = false;
        if (sessionPromiseRef.current) {
          sessionPromiseRef.current.then(session => session.close());
          sessionPromiseRef.current = null;
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }
        if (sourceNodeRef.current) {
            sourceNodeRef.current.disconnect();
            sourceNodeRef.current = null;
        }
        if (audioProcessorNodeRef.current) {
            audioProcessorNodeRef.current.disconnect();
            audioProcessorNodeRef.current = null;
        }
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
          inputAudioContextRef.current.close();
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
          outputAudioContextRef.current.close();
        }
        setConversationHistory([]);
        setUserTranscript('');
        setModelTranscript('');
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-50 animate-fade-in" onClick={handleClose}>
      <div className="bg-gray-900 text-white rounded-2xl shadow-2xl w-full max-w-lg h-[80vh] flex flex-col p-6 relative" onClick={e => e.stopPropagation()}>
        <div className="text-center mb-4">
          <h2 className="text-2xl font-serif text-amber-400">Asesor en Vivo</h2>
          <p className="text-gray-400">{status}</p>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-gray-800/50 rounded-lg p-4 space-y-3">
            {conversationHistory.map((entry, index) => (
                <div key={index} className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs p-3 rounded-lg ${entry.speaker === 'user' ? 'bg-amber-600' : 'bg-gray-700'}`}>
                        <p>{entry.text}</p>
                    </div>
                </div>
            ))}
            {modelTranscript && (
                 <div className="flex justify-start">
                    <div className="max-w-xs p-3 rounded-lg bg-gray-700 opacity-70">
                        <p>{modelTranscript}</p>
                    </div>
                </div>
            )}
             {userTranscript && (
                 <div className="flex justify-end">
                    <div className="max-w-xs p-3 rounded-lg bg-amber-600 opacity-70">
                        <p>{userTranscript}</p>
                    </div>
                </div>
            )}
        </div>
        
        <div className="mt-6 text-center">
            <button
                onClick={handleClose}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full transition-colors duration-300"
            >
                Finalizar Conversación
            </button>
        </div>
      </div>
    </div>
  );
};

export default LiveConversationModal;