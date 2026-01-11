import { GoogleGenAI, Type, Modality } from "@google/genai";
import { TutorialData } from "../types";

// Helper to decode Base64
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Exported helper to decode PCM audio to AudioBuffer using a provided context
export async function createAudioBufferFromPCM(
  base64Data: string,
  ctx: AudioContext,
  sampleRate: number = 24000
): Promise<AudioBuffer> {
  const bytes = decode(base64Data);
  const dataInt16 = new Int16Array(bytes.buffer);
  const numChannels = 1;
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

export const generateTutorialContent = async (topic: string): Promise<TutorialData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    You are an expert coding influencer creating a viral TikTok-style tutorial for: "${topic}".

    STRICT CONTENT GUIDELINES:
    1. **Overview (The Hook)**: 
       - Do NOT start with "In this tutorial...". Boring!
       - Start with a Hook! (e.g., "Stop doing X!", "Here is the pro way to do Y", "You won't believe how easy this is").
       - Keep it high-energy and go straight to the point.

    2. **Steps (The Deep Dive)**: 
       - Do NOT just read the code aloud (e.g., don't say "We declare a variable x").
       - **Explain the WHY and HOW**: Explain the specific methods called, their role, and why we chose this approach.
       - **Technical Details**: Mention parameters, return types, or architectural choices.
       - Example: Instead of "We make a button", say "We use the 'st.button' method here because it handles the boolean state automatically for us. Notice the 'key' parameter..."

    3. **Language**:
       - Detect the language of the user's request (e.g., French, English). 
       - The output MUST be in the SAME language as the request.

    4. **Code Formatting (CRITICAL)**:
       - The 'code' MUST be properly formatted with newlines and standard indentation. 
       - **NEVER** output the code as a single compressed line. 
       - Use multi-line blocks to improve readability.
       - Ensure 'lineCode' in steps matches exactly a substring in the full 'code'.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "A catchy, viral title for the tutorial" },
          language: { type: Type.STRING, description: "The programming language used (e.g. Python, JavaScript)" },
          code: { type: Type.STRING, description: "The full code snippet, correctly formatted with newlines." },
          overview: { type: Type.STRING, description: "The TikTok-style Hook introduction." },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lineCode: { type: Type.STRING, description: "The specific line or block of code being explained. Must match exactly." },
                explanation: { type: Type.STRING, description: "Detailed, technical explanation of methods and logic." }
              }
            }
          }
        },
        required: ["title", "language", "code", "overview", "steps"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No content generated");
  return JSON.parse(text) as TutorialData;
};

// Returns raw base64 strings for each segment (Overview + Steps)
// Returns null for segments where TTS failed, allowing the app to handle it gracefully.
export const generateAudioSegments = async (data: TutorialData): Promise<(string | null)[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Segments: 1. Overview, 2. Step 1, 3. Step 2...
  const segments = [data.overview, ...data.steps.map(step => step.explanation)];

  const generateSegment = async (text: string): Promise<string | null> => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Fenrir' },
            },
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (error) {
      // Log warning but return null to prevent app crash on TTS failure
      console.warn("TTS generation failed for segment (quota or error). Proceeding without audio.", error);
      return null;
    }
  };

  // Process segments
  return Promise.all(segments.map(s => generateSegment(s)));
};

export const explainCodeSnippet = async (snippet: string, context: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Context: A coding tutorial about "${context}".
    
    The user is asking for a "Deep Dive" explanation on this specific code snippet:
    \`\`\`
    ${snippet}
    \`\`\`
    
    Provide a clear, educational, and slightly detailed explanation of what this specific line/block does, how it works, and why it's used. 
    Keep it concise (under 150 words) but technical enough to be useful. 
    Format with Markdown.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text || "Could not generate explanation.";
};