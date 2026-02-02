
import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

export const translateText = async (
  text: string,
  targetLanguage: string,
  sourceLanguage?: string
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API key is missing");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    You are a professional translator. Translate the following text into ${targetLanguage}.
    ${sourceLanguage ? `The source language is ${sourceLanguage}.` : "Detect the source language automatically."}
    
    Guidelines:
    - Maintain the original tone and intent (formal, informal, slang, etc.).
    - Preserve any emojis.
    - If the text is already in ${targetLanguage}, return the original text.
    - Return ONLY the translated text. Do not include any explanations or metadata.
    
    Text to translate:
    "${text}"
  `;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1, // Low temperature for consistent translation
        maxOutputTokens: 1000,
        // When setting maxOutputTokens, you must also set thinkingConfig.thinkingBudget (e.g., 500 budget for 1000 total tokens)
        thinkingConfig: { thinkingBudget: 500 },
      }
    });

    return response.text?.trim() || text;
  } catch (error) {
    console.error("Translation error:", error);
    return text; // Fallback to original text on error
  }
};
