import Groq from "groq-sdk";
import { Langfuse } from "langfuse";

export async function runAgent(
    input: string, 
    groqApiKey: string, 
    langfuseKeys?: { publicKey: string; secretKey: string },
    systemPrompt: string = "Eres un asistente útil."
) {
    console.log("runAgent started with input:", input);

    const groq = new Groq({
        apiKey: groqApiKey,
        dangerouslyAllowBrowser: true 
    });

    let langfuse: Langfuse | null = null;
    let trace: any = null;
    let generation: any = null;

    if (langfuseKeys) {
        langfuse = new Langfuse({
            publicKey: langfuseKeys.publicKey,
            secretKey: langfuseKeys.secretKey,
            baseUrl: "http://localhost:3000" // Defaulting to local as per user's context of localhost:3000
        });

        trace = langfuse.trace({
            name: "chat-agent-groq-streaming",
            input: String(input),
            metadata: {
                systemPrompt: String(systemPrompt)
            }
        });

        generation = trace.generation({
            name: "groq-call",
            model: "openai/gpt-oss-120b",
            input: String(input),
        });
    }

    try {
        const stream = await groq.chat.completions.create({
            model: "openai/gpt-oss-120b",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: input },
            ],
            temperature: 1,
            max_completion_tokens: 1024,
            top_p: 1,
            stream: true,
            // @ts-ignore
            reasoning_effort: "medium",
        });

        let fullText = "";
        let usageMetadata = null;

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            fullText += content;
            
            if (chunk.x_groq?.usage) {
                usageMetadata = chunk.x_groq.usage;
            }
        }

        if (generation) {
            generation.end({
                output: fullText,
                usage: {
                    promptTokens: usageMetadata?.prompt_tokens,
                    completionTokens: usageMetadata?.completion_tokens,
                    totalTokens: usageMetadata?.total_tokens,
                },
            });
        }

        if (trace) {
            trace.update({
                output: fullText
            });
        }

        return fullText;
    } catch (error) {
        console.error("Groq Error:", error);
        if (trace) {
            trace.update({
                output: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
            });
        }
        throw error;
    } finally {
        if (langfuse) {
            await langfuse.flushAsync();
        }
    }
}

export async function runRefundAgent(
    groqApiKey: string,
    langfuseKeys: { publicKey: string; secretKey: string },
    variables: { customer_type: string; days_since_purchase: number; reason: string }
) {
    const langfuse = new Langfuse({
        publicKey: langfuseKeys.publicKey,
        secretKey: langfuseKeys.secretKey,
        baseUrl: "http://localhost:3000"
    });

    const groq = new Groq({
        apiKey: groqApiKey,
        dangerouslyAllowBrowser: true
    });

    // 1. Fetch the prompt from Langfuse
    const prompt = await langfuse.getPrompt("refund_bot", undefined, { label: "production" });
    
    // 2. Compile the prompt with variables
    const compiledContent = prompt.compile(variables);

    const trace = langfuse.trace({
        name: "refund-service-practice",
        input: variables,
    });

    const generation = trace.generation({
        name: "refund-decision",
        model: "openai/gpt-oss-120b",
        input: compiledContent,
        promptName: "refund_bot",
        promptVersion: prompt.version
    });

    try {
        const completion = await groq.chat.completions.create({
            model: "openai/gpt-oss-120b",
            messages: [
                { role: "system", content: "Eres el sistema de decisiones de reembolso de AliExpress." },
                { role: "user", content: compiledContent },
            ],
            temperature: 0,
        });

        const result = completion.choices[0]?.message?.content || "";

        generation.end({
            output: result,
            usage: {
                promptTokens: completion.usage?.prompt_tokens,
                completionTokens: completion.usage?.completion_tokens,
                totalTokens: completion.usage?.total_tokens,
            },
        });

        trace.update({ output: result });
        
        return result;
    } catch (error) {
        console.error("Refund Agent Error:", error);
        if (trace) trace.update({ output: String(error) });
        throw error;
    } finally {
        await langfuse.flushAsync();
    }
}
