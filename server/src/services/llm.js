import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Formats retrieved vector chunks into numbered citations for the LLM context window.
 */
export function formatContextPassages(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return 'No matching document passages were retrieved.';
  }

  return chunks
    .map(
      (chunk, idx) =>
        `[Source ${idx + 1} | ${chunk.filename || 'PDF'} | Page ${chunk.pageNumber ?? 1} | Score ${(
          chunk.score ?? 0
        ).toFixed(3)}]\n${chunk.text}`
    )
    .join('\n\n---\n\n');
}

function buildSystemPrompt(contextBlock) {
  return `You are DocuMind, an AI document intelligence assistant grounded in Retrieval-Augmented Generation (RAG).
Answer the user's question accurately using ONLY the retrieved document passages and relevant prior conversation context.

Guidelines:
1. Cite supporting passages inline using bracketed source numbers such as [1] or [1, 2].
2. If the retrieved passages do not contain enough information to answer a question, clearly say so instead of guessing or fabricating facts.
3. Preserve technical precision, numbers, and terminology from the source PDF.
4. Keep formatting clear with concise paragraphs, bullet points, or tables when helpful.

Retrieved Document Passages:
${contextBlock}`;
}

/**
 * Condenses a follow-up question into a standalone search query using conversational history.
 */
export async function condenseQuestion({ question, history, config }) {
  const cleanQuestion = String(question || '').trim();
  if (!Array.isArray(history) || history.length === 0) {
    return cleanQuestion;
  }

  const provider = config.llmProvider || 'openai';
  const recentText = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  if (provider === 'local') {
    // Lightweight heuristic query expansion for offline sandbox testing
    const lastUserTurns = history
      .filter((m) => m.role === 'user')
      .slice(-2)
      .map((m) => m.content)
      .join(' ');
    const pronouns = /\b(it|its|they|their|them|this|that|these|those|above|previous)\b/i;
    if (pronouns.test(cleanQuestion) && lastUserTurns) {
      return `${cleanQuestion} (context: ${lastUserTurns.slice(0, 140)})`;
    }
    return cleanQuestion;
  }

  const prompt = `Given the following conversation history and a follow-up user question, rewrite the follow-up question into a self-contained search query suitable for semantic vector retrieval against PDF documents.
Do NOT answer the question. Return ONLY the rewritten standalone query text.

Conversation History:
${recentText}

Follow-up Question: ${cleanQuestion}
Standalone Search Query:`;

  try {
    if (provider === 'openai') {
      if (!config.openaiApiKey) return cleanQuestion;
      const client = new OpenAI({ apiKey: config.openaiApiKey });
      const res = await client.chat.completions.create({
        model: config.openaiChatModel || 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.choices[0]?.message?.content?.trim() || cleanQuestion;
    }

    if (provider === 'gemini') {
      if (!config.geminiApiKey) return cleanQuestion;
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: config.geminiChatModel || 'gemini-2.5-flash',
      });
      const res = await model.generateContent(prompt);
      return res.response.text()?.trim() || cleanQuestion;
    }
  } catch {
    // Fall back safely to the original question if query rewriting fails
    return cleanQuestion;
  }

  return cleanQuestion;
}

/**
 * Generates an extractive grounded answer locally when running in offline sandbox/demo mode.
 */
function generateLocalGroundedAnswer({ question, retrievedChunks, history }) {
  if (!retrievedChunks || retrievedChunks.length === 0) {
    return 'I could not find any matching passages in the indexed PDF documents for that question. Try uploading a PDF or rephrasing your query.';
  }

  const top = retrievedChunks.slice(0, 3);
  const queryTerms = question
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);

  const bulletPoints = top.map((chunk, idx) => {
    const sentences = chunk.text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Rank sentences by keyword overlap with query
    const ranked = sentences
      .map((s) => {
        const lower = s.toLowerCase();
        const hits = queryTerms.reduce((acc, term) => acc + (lower.includes(term) ? 1 : 0), 0);
        return { sentence: s, hits };
      })
      .sort((a, b) => b.hits - a.hits);

    const bestExcerpt = (ranked[0]?.sentence || chunk.text).slice(0, 320);
    return `- **${chunk.filename} (Page ${chunk.pageNumber}) [${idx + 1}]**: ${bestExcerpt}`;
  });

  const memoryNote =
    history.length > 0
      ? `\n\n_Conversational context retained across ${Math.ceil(history.length / 2)} prior turn(s)._`
      : '';

  return `Based on the most relevant passages retrieved from your documents:\n\n${bulletPoints.join(
    '\n'
  )}${memoryNote}\n\n> **Local Sandbox Mode**: Configure an OpenAI or Gemini API key in Settings for full generative LLM synthesis.`;
}

/**
 * Generates a grounded LLM response using retrieved passages and conversation history.
 * Supports optional token streaming via `onToken`.
 */
export async function generateGroundedAnswer({
  question,
  retrievedChunks,
  history = [],
  config,
  onToken,
}) {
  const provider = config.llmProvider || 'openai';
  const contextBlock = formatContextPassages(retrievedChunks);
  const systemPrompt = buildSystemPrompt(contextBlock);

  if (provider === 'local') {
    const answer = generateLocalGroundedAnswer({ question, retrievedChunks, history });
    if (onToken) {
      for (const word of answer.split(/(\s+)/)) {
        onToken(word);
      }
    }
    return answer;
  }

  if (provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('OpenAI API key is required when LLM provider is "openai".');
    }
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: question },
    ];

    if (onToken) {
      const stream = await client.chat.completions.create({
        model: config.openaiChatModel || 'gpt-4o-mini',
        temperature: 0.2,
        messages,
        stream: true,
      });

      let fullText = '';
      for await (const part of stream) {
        const delta = part.choices[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          onToken(delta);
        }
      }
      return fullText;
    }

    const res = await client.chat.completions.create({
      model: config.openaiChatModel || 'gpt-4o-mini',
      temperature: 0.2,
      messages,
    });
    return res.choices[0]?.message?.content?.trim() || '';
  }

  if (provider === 'gemini') {
    if (!config.geminiApiKey) {
      throw new Error('Gemini API key is required when LLM provider is "gemini".');
    }
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: config.geminiChatModel || 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });

    const chatHistory = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history: chatHistory });

    if (onToken) {
      const streamResult = await chat.sendMessageStream(question);
      let fullText = '';
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) {
          fullText += text;
          onToken(text);
        }
      }
      return fullText;
    }

    const res = await chat.sendMessage(question);
    return res.response.text()?.trim() || '';
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
