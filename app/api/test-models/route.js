import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelsToTest = ["gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.7-flash", "gemini-3.5-flash"];
  const results = {};
  
  for (const m of modelsToTest) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const result = await model.generateContent("Hello");
      results[m] = "SUCCESS: " + result.response.text();
    } catch (e) {
      results[m] = "FAILED: " + e.message;
    }
  }
  return NextResponse.json(results);
}
