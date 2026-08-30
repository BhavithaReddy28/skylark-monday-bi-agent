const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const modelsToTest = [
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite"
];

async function testModels() {
  for (const m of modelsToTest) {
    try {
      console.log("Testing:", m);
      const model = genAI.getGenerativeModel({ model: m });
      const result = await model.generateContent("Hello");
      console.log("SUCCESS:", m, result.response.text());
      break;
    } catch (e) {
      console.error("FAILED:", m, e.message.substring(0, 100));
    }
  }
}
testModels();
