import { Client, Intents, Message, PartialMessage } from "discord.js";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const MAX_MESSAGE_LENGTH = 2000;

const STRINGS = {
    INVOKE_TOKEN: "[gptj]",
    INVOKE_REPLY: "*closes robot-eyes to enter a deep think...*",
    ELABORATE_REPLY: "*let me elaborate...*",
    ALREADY_USED_REPLY: "*I've already responded to this!*",
    BUSY_REPLY: "*I'm a little busy, I'll consider this soon!*",
};

type RunStatus = "running" | "success" | "error";

const INPUT_MESSAGE_IDS: Record<string, RunStatus> = {}

type ProcessQueueItem = { message: Message<boolean> | PartialMessage, isElaboration: boolean };

class ProcessQueue {
    private static queue: ProcessQueueItem[] = [];
    private static currentOperation: Promise<void> = null;
    public static Enqueue(item: ProcessQueueItem) {
        if (this.currentOperation == null) {
            this.currentOperation = useMessageAsInput(item.message, item.isElaboration).then(() => this.processNext());
        }
        else {
            item.message.reply(STRINGS.BUSY_REPLY);
            this.queue.push(item);
        }
    }
    private static processNext() {
        if (this.queue.length === 0) {
            this.currentOperation = null;
            return;
        }
        const [item] = this.queue.splice(0, 1);
        this.currentOperation = useMessageAsInput(item.message, item.isElaboration).then(() => this.processNext());
    }
}

const { BOT_TOKEN, PIPELINE_ID, API_TOKEN } = process.env;

const client = new Client({
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS],
    partials: ['MESSAGE', 'CHANNEL', 'REACTION'],
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith(STRINGS.INVOKE_TOKEN)) {
        return;
    }
    try {
        ProcessQueue.Enqueue({message, isElaboration: false});
    }
    catch(e){
        message.reply(`[ERROR] ${e}`);
    }
});

client.on("messageReactionAdd", async (reaction, user) => {
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error("Error fetching reaction:", error);
            return;
        }
    }
    if (reaction.emoji.name === "🤖") {
        ProcessQueue.Enqueue({message: reaction.message, isElaboration: true});
    }
});

async function useMessageAsInput(message: Message<boolean> | PartialMessage, isElaboration: boolean) {
    // check if the message has already been used as input
    // (this prevents multiple reactions triggering multiple elaborations)
    if (message.id in INPUT_MESSAGE_IDS) {
        message.reply(STRINGS.ALREADY_USED_REPLY);
        return;
    }

    INPUT_MESSAGE_IDS[message.id] = "running";

    const initialReply = isElaboration ? STRINGS.ELABORATE_REPLY : STRINGS.INVOKE_REPLY;
    message.reply(initialReply);

    let input = message.content.trim();
    if (!isElaboration) {
        // remove invoke token from the beginning of the input
        input = input.substring(STRINGS.INVOKE_TOKEN.length);
    }

    const resultString = await invokeGPTJ(input);
    let nextStartIndex = 0;
    while (nextStartIndex < resultString.length) {
        const remaining = resultString.length - nextStartIndex;
        const messageLength = remaining > MAX_MESSAGE_LENGTH ? MAX_MESSAGE_LENGTH : remaining;
        const content = resultString.substring(nextStartIndex, messageLength);
        message.reply(content);
        nextStartIndex += messageLength;
    }
}

async function invokeGPTJ(input: string): Promise<string> {
    const payload = {
        pipeline_id: PIPELINE_ID,
        data: [
            input,
            {
                response_length: 200,
                include_input: true,
                temperature: 0.85,
                top_k: 50,
                top_p: 0.85
            }
        ]
    };
    const url = "https://api.pipeline.ai/v2/runs";
    const response = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${API_TOKEN}`
        },
        responseType: "json"
    });
    const r = response.data?.result_preview;
    return (r == null || r.length === 0 || r[0].length === 0) 
        ? "[no result]"
        : r[0][0]; // <- eyes
}

client.login(BOT_TOKEN);
