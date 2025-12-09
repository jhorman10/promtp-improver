import * as vscode from "vscode";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface AIAnalysisResult {
  critique: string;
  improvedPrompt: string;
  intent: "EXECUTION" | "CONTEXT" | "QUESTION";
  actionPlan?: string;
}

export class AIService {
  private static getConfiguration() {
    return vscode.workspace.getConfiguration("promptImprover");
  }

  private static getApiKey(provider: string): string | undefined {
    const config = this.getConfiguration();
    return config.get<string>(`${provider}ApiKey`);
  }

  public static async analyze(
    prompt: string,
    context: string,
    attachments: any[],
    language: string = "en"
  ): Promise<AIAnalysisResult> {
    const config = this.getConfiguration();
    const provider = config.get<string>("provider") || "gemini";
    const apiKey = this.getApiKey(provider);

    // For GitHub and Gemini, we can use session auth if no API key
    if (!apiKey && provider !== "github" && provider !== "gemini") {
      throw new Error(
        `API Key for ${provider} is missing. Please set it in VS Code settings.`
      );
    }

    const langInstruction =
      language === "es"
        ? "IMPORTANTE: Responde siempre en español."
        : "IMPORTANT: Always respond in English.";

    const systemPrompt = `You are an expert prompt engineer and code assistant. Your goal is to analyze the user's prompt based on the 4-part framework and determine the user's intent.

First, classify the user's intent into one of these categories:
- EXECUTION: The user wants you to write code, modify files, or run commands.
- CONTEXT: The user is providing information/files for future reference or context building.
- QUESTION: The user is asking a question about the code or concepts, without requesting direct changes.

Then, analyze the prompt using the 4-part framework:
1. Context: Who is the persona? What is the background?
2. Objective: What exactly do you want to achieve?
3. Constraints: What are the limitations or guidelines?
4. Output Format: How should the response look like?

Analyze the user's prompt and the provided context/attachments.
If any part is missing or weak, point it out in the "critique".
Then, generate a significantly "improvedPrompt" that includes all 4 parts and incorporates the context.

If the intent is EXECUTION, provide a brief "actionPlan" describing what steps should be taken (e.g., "1. Modify file X... 2. Run command Y...").
If the intent is CONTEXT, the "actionPlan" should be "Store context for future use."
If the intent is QUESTION, the "actionPlan" should be "Answer the user's question with provided context."

${langInstruction}

Return the response in JSON format:
{
    "critique": "string",
    "improvedPrompt": "string",
    "intent": "EXECUTION" | "CONTEXT" | "QUESTION",
    "actionPlan": "string (optional)"
}
`;

    // Format attachments for better readability
    const formattedAttachments = attachments
      .map(
        (att) =>
          `--- File: ${att.name} ---\n${att.data}\n--- End of ${att.name} ---`
      )
      .join("\n\n");

    const fullUserMessage = `User Prompt: ${prompt}

Context from Editor:
${context}

Attached Files:
${formattedAttachments || "No files attached"}`;

    try {
      switch (provider) {
        case "gemini":
          if (apiKey) {
            return await this.callGemini(apiKey, systemPrompt, fullUserMessage);
          } else {
            // Try to get session if no API key
            const session = await vscode.authentication.getSession(
              "google",
              [
                "https://www.googleapis.com/auth/generative-language",
                "email",
                "profile",
              ],
              { createIfNone: false }
            );
            if (session) {
              return await this.callGeminiWithToken(
                session.accessToken,
                systemPrompt,
                fullUserMessage
              );
            } else {
              throw new Error(
                `API Key for ${provider} is missing and no Google session found. Please set API key or sign in.`
              );
            }
          }
        case "anthropic":
          if (!apiKey) throw new Error("Anthropic API Key missing");
          return await this.callAnthropic(
            apiKey,
            systemPrompt,
            fullUserMessage
          );
        case "openai":
          if (!apiKey) throw new Error("OpenAI API Key missing");
          return await this.callOpenAI(apiKey, systemPrompt, fullUserMessage);
        case "github":
          return await this.callGithub(apiKey, systemPrompt, fullUserMessage);
        default:
          throw new Error(`Provider ${provider} not supported.`);
      }
    } catch (error: any) {
      throw new Error(`AI Error (${provider}): ${error.message}`);
    }
  }

  private static async callGemini(
    apiKey: string,
    systemPrompt: string,
    userMessage: string
  ): Promise<AIAnalysisResult> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent(
      `${systemPrompt}\n\n${userMessage}`
    );
    const response = result.response;
    const text = response.text();

    return this.parseResponse(text);
  }

  private static async callGeminiWithToken(
    token: string,
    systemPrompt: string,
    userMessage: string
  ): Promise<AIAnalysisResult> {
    // Use REST API with Bearer token
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\n${userMessage}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini API Error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    // Parse response from REST API structure
    // data.candidates[0].content.parts[0].text
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return this.parseResponse(text);
  }

  private static async callAnthropic(
    apiKey: string,
    systemPrompt: string,
    userMessage: string
  ): Promise<AIAnalysisResult> {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = msg.content[0].text;
    return this.parseResponse(text);
  }

  private static async callOpenAI(
    apiKey: string,
    systemPrompt: string,
    userMessage: string
  ): Promise<AIAnalysisResult> {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      model: "gpt-4-turbo-preview",
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0].message.content || "{}";
    return JSON.parse(text);
  }

  private static async callGithub(
    apiKey: string | undefined,
    systemPrompt: string,
    userMessage: string
  ): Promise<AIAnalysisResult> {
    // Try to get session if no API key provided (or even if it is, session is preferred for "github" provider usually)
    let token = apiKey;
    if (!token) {
      const session = await vscode.authentication.getSession(
        "github",
        ["read:user", "user:email"],
        { createIfNone: false }
      );
      if (session) {
        token = session.accessToken;
      }
    }

    if (!token) {
      throw new Error(
        "GitHub Token not found. Please sign in with GitHub in settings or provide a token."
      );
    }

    const openai = new OpenAI({
      baseURL: "https://models.inference.ai.azure.com",
      apiKey: token,
    });

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      model: "gpt-4o",
      temperature: 1,
      max_tokens: 4096,
      top_p: 1,
    });

    const text = completion.choices[0].message.content || "{}";
    // GitHub models might not support JSON mode strictly, so we parse carefully
    return this.parseResponse(text);
  }

  private static parseResponse(text: string): AIAnalysisResult {
    try {
      // Clean up markdown code blocks if present
      const cleanText = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      return JSON.parse(cleanText);
    } catch (e) {
      console.error("Failed to parse AI response", text);
      return {
        critique: "Failed to parse AI response. Raw response: " + text,
        improvedPrompt: "Could not generate improved prompt.",
        intent: "QUESTION", // Default fallback
      };
    }
  }
}
