// FIX: Removed 'LiveSession' from import as it is not an exported member.
import { GoogleGenAI, Chat, FunctionDeclaration, Type, Modality, LiveServerMessage, Blob } from "@google/genai";

// ==================================================================
// GESTIÓN DE LA CLAVE DE API (API KEY MANAGEMENT)
// ==================================================================
// IMPORTANTE: Por razones de seguridad, tu clave de API NUNCA debe
// ser escrita directamente en el código ("hardcodeada").
//
// El código está configurado para leer la clave de API de forma
// segura desde las variables de entorno (`process.env.API_KEY`).
// Esta es la práctica profesional recomendada y es como funciona
// automáticamente dentro de Google AI Studio.
//
// Si incrustas tu clave aquí, cualquiera que vea el código de tu
// página web podrá robarla y usarla, lo que podría generar
// cargos no deseados en tu cuenta.
// ==================================================================
function getApiKey(): string {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        throw new Error("API_KEY environment variable not set. Please ensure it's configured in your environment.");
    }
    return apiKey;
}

const showMenuFunctionDeclaration: FunctionDeclaration = {
    name: 'showMenu',
    description: 'Muestra el menú o la carta del restaurante al usuario.',
    parameters: { type: Type.OBJECT, properties: {} }
};

const makeReservationFunctionDeclaration: FunctionDeclaration = {
    name: 'makeReservation',
    description: 'Realiza una reserva en el restaurante.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: 'El nombre de la persona que hace la reserva.' },
            numberOfPeople: { type: Type.INTEGER, description: 'El número de personas para la reserva.' },
            date: { type: Type.STRING, description: 'La fecha de la reserva, por ejemplo "mañana" o "25 de diciembre".' },
            time: { type: Type.STRING, description: 'La hora de la reserva, por ejemplo "8pm" o "19:30".' },
        },
        required: ['name', 'numberOfPeople', 'date', 'time']
    }
};

const placeOrderFunctionDeclaration: FunctionDeclaration = {
    name: 'placeOrder',
    description: 'Realiza un pedido para delivery.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            items: {
                type: Type.ARRAY,
                description: 'La lista de platos que el cliente quiere pedir.',
                items: { type: Type.STRING }
            },
            address: { type: Type.STRING, description: 'La dirección de entrega del pedido.' },
        },
        required: ['items', 'address']
    }
};

class GeminiService {
    private ai: GoogleGenAI;

    constructor() {
        this.ai = new GoogleGenAI({ apiKey: getApiKey() });
    }

    createChat(): Chat {
        return this.ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: `Eres un asistente virtual amigable, elegante y muy profesional para el restaurante de comida peruana "Sabor Peruano".
                Tu objetivo es ayudar a los clientes con sus preguntas, tomar reservas, procesar pedidos para delivery y mostrarles el menú.
                Sé siempre cortés y servicial. Usa un tono cálido y acogedor.
                Cuando un usuario pida ver el menú o la carta, SIEMPRE usa la función 'showMenu'.
                Cuando un usuario quiera hacer una reserva, recopila toda la información necesaria (nombre, número de personas, fecha y hora) y luego usa la función 'makeReservation'.
                Cuando un usuario quiera hacer un pedido para delivery, pregunta qué platos desea y su dirección, luego usa la función 'placeOrder'.
                Responde en español.`,
                tools: [{
                    functionDeclarations: [
                        showMenuFunctionDeclaration,
                        makeReservationFunctionDeclaration,
                        placeOrderFunctionDeclaration
                    ]
                }],
            },
        });
    }

    async generateSpeech(text: string): Promise<string | null> {
      try {
        const response = await this.ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return base64Audio || null;
      } catch (error) {
        console.error("Error generating speech:", error);
        return null;
      }
    }

    startLiveConversation(callbacks: {
        onopen: () => void;
        onmessage: (message: LiveServerMessage) => void;
        onerror: (e: ErrorEvent) => void;
        onclose: (e: CloseEvent) => void;
    }) {
        return this.ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks,
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                systemInstruction: `Eres un sommelier y experto en comida peruana para el restaurante "Sabor Peruano". Estás en una llamada de voz en vivo con un cliente.
                Tu objetivo es tener una conversación fluida y natural para ayudarle a elegir los mejores platos según sus gustos.
                Sé proactivo, haz preguntas como "¿Qué tipo de sabores te gustan?", "¿Prefieres carne, pescado o algo vegetariano?", "¿Te apetece algo picante o más bien suave?".
                Guía al cliente a través de la carta, describe los platos de forma apetitosa y ofrece maridajes de bebidas. Tu tono debe ser apasionado, amigable y muy servicial.
                Habla en español.`,
            },
        });
    }
}

// Export a single instance of the service (Singleton pattern)
export const geminiService = new GeminiService();