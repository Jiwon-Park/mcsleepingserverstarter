import { getLogger, LoggerType } from "./sleepingLogger";
import { Settings } from "./sleepingSettings";
import { Player } from "./sleepingTypes";

type DiscordContent = {
  content: null;
  embeds: {
    title: string;
    color: number;
  }[];
};

export class SleepingDiscord {
  logger: LoggerType;
  settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
    this.logger = getLogger();
  }

  private sendMessage = async (content: DiscordContent, woke: boolean) => {
    if (woke) {
      this.logger.info(`[Discord] Sending waking up message`);
    } else {
      this.logger.info(`[Discord] Sending closing server message`);
    }

    if (this.settings.discordWebhookUrl) {
      const response = await fetch(this.settings.discordWebhookUrl, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify(content),
      });

      this.logger.info("[Discord] response: ", await response.text());
    }
  };

  onServerStart = async () => {
    const content = {
      content: null,
      embeds: [
        {
          title: `서버가 켜졌습니다!`,
          color: 25344,
        },
      ],
    };
    await this.sendMessage(content, true);
  };

  onServerStop = async () => {
    const content = {
      content: null,
      embeds: [
        {
          title: "서버가 꺼졌습니다.",
          color: 12260372,
        },
      ],
    };
    await this.sendMessage(content, false);
  };

  onPlayerJoin = async (player: Player) => {
    const content = {
      content: null,
      embeds: [
        {
          title: `👋 ${player} joined the server.`,
          color: 25344,
        },
      ],
    };
    await this.sendMessage(content, false);
  }
  
  onPlayerLeft = async (player: Player) => {
    const content = {
      content: null,
      embeds: [
        {
          title: `👋 ${player} left the server.`,
          color: 25344,
        },
      ],
    };
    await this.sendMessage(content, false);
  }
}
