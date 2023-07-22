import { ChildProcess, execSync, spawn } from "child_process";
import { platform } from "os";
import { SleepingBedrock } from "./sleepingBedrock";
import { SleepingDiscord } from "./sleepingDiscord";
import { isPortTaken, ServerStatus } from "./sleepingHelper";
import { getLogger, LoggerType, version } from "./sleepingLogger";
import { SleepingMcJava } from "./sleepingMcJava";
import { ISleepingServer } from "./sleepingServerInterface";
import { getSettings, Settings } from "./sleepingSettings";
import { PlayerConnectionCallBackType } from "./sleepingTypes";
import { SleepingWeb } from "./sleepingWeb";

export const MC_TIMEOUT = 5000;

export class SleepingContainer implements ISleepingServer {
  logger: LoggerType;
  settings: Settings;

  mcServer?: SleepingMcJava;
  mcProcess?: ChildProcess;
  brServer?: SleepingBedrock;
  webServer?: SleepingWeb;

  discord?: SleepingDiscord;

  isClosing = false;
  playerNumber = 0;

  // constructor(callBack: (settings: Settings) => void) {
  //   this.logger = getLogger();
  //   this.settings = getSettings();
  //   callBack(this.settings);
  // }

  constructor() {
    this.logger = getLogger();
    this.settings = getSettings();
    if (!this.settings.preventStop) {
      this.logger.info(`[Main] Waiting for 'quit' in CLI.`);
      process.stdin.on("data", (text) => {
        if (text.indexOf("quit") > -1) {
          this.playerConnectionCallBack("A CliUser");
        }
        else if (this.mcProcess?.connected) {
          this.mcProcess.stdin?.write(text + "\n\n");
          this.mcProcess.send(text + "\n\n");
        }
      });
    }
  }

  init = async (isThisTheBeginning = false) => {
    if (isThisTheBeginning || this.settings.webStopOnStart) {
      if (this.settings.webPort > 0) {
        this.webServer = new SleepingWeb(
          this.settings,
          this.playerConnectionCallBack,
          this
        );
        await this.webServer?.init();
      }
    }

    if (this.settings.serverPort > 0) {
      this.mcServer = new SleepingMcJava(
        this.settings,
        this.playerConnectionCallBack
      );
      await this.mcServer?.init();
    }

    if (this.settings.bedrockPort) {
      this.brServer = new SleepingBedrock(
        this.settings,
        this.playerConnectionCallBack
      );
      await this.brServer?.init();
    }

    if (this.settings.discordWebhookUrl) {
      this.discord = new SleepingDiscord(this.settings);
    }
  };

  startMinecraft = async (onProcessClosed: () => void) => {
    this.logger.info(
      `----------- [v${version}] Starting Minecraft : ${this.settings.minecraftCommand} ----------- `
    );

    if (this.settings.webPort > 0 && !this.settings.webStopOnStart) {
      const cmdArgs = this.settings.minecraftCommand.split(" ");
      const exec = cmdArgs.splice(0, 1)[0];
      this.playerNumber = 0;

      this.mcProcess = spawn(exec, cmdArgs, {
        stdio: ['ipc', "pipe", "inherit"],
        cwd: this.settings.minecraftWorkingDirectory ?? process.cwd(),
      });
      this.mcProcess.stdout?.on("data", async (data : Buffer) => {
        let outstr = data.toString('utf-8').trimEnd();
        console.log(outstr);
        if (outstr.length > 70 && outstr.endsWith('joined the game')) {
          let playerName = outstr.slice(61, outstr.length - 16);
          this.logger.info(`[Minecraft] ${playerName} 님이 접속하셨습니다.`);
          await this.discord?.onPlayerJoin(playerName);
        }
        if (outstr.length > 70 && outstr.endsWith('left the game')) {
          let playerNmae = outstr.slice(61, outstr.length - 14);
          this.logger.info(`[Minecraft] ${playerNmae} 님이 떠나셨습니다.`);
          await this.discord?.onPlayerLeft(playerNmae);
        }
        // this.logger.info(`[Minecraft] ${data}`);
      });
      this.mcProcess.on("close", (code) => {
        this.logger.info(
          `----------- [v${version}] Minecraft stopped ${code} -----------`
        );
        onProcessClosed();
      });
    } else {
      execSync(this.settings.minecraftCommand, {
        stdio: "inherit",
        cwd: this.settings.minecraftWorkingDirectory ?? process.cwd(),
      });
      this.logger.info(
        `----------- [v${version}] Minecraft stopped -----------`
      );
      onProcessClosed();
    }
  };

  killMinecraft = () => {
    if (this.settings.preventStop) {
      this.logger.info(`[Container] killMinecraft: preventStop is set.`);
      return;
    }

    if (platform() !== "win32") {
      this.mcProcess?.kill();
    } else {
      this.logger.info(
        `[Container] Not killing server:${platform()}, signals are not working well on Windows`
      );
    }
  };

  close = async (isThisTheEnd = false) => {
    this.logger.info("[Container] Cleaning up the place.");

    if (this.mcServer) {
      await this.mcServer.close();
    }

    if (this.brServer) {
      await this.brServer.close();
    }

    if (isThisTheEnd || this.settings.webStopOnStart) {
      if (this.webServer) {
        this.webServer.close();
      }
    }
  };

  playerConnectionCallBack: PlayerConnectionCallBackType = async (
    playerName: string
  ) => {
    if (
      this.settings.whiteListedNames &&
      !this.settings.whiteListedNames.includes(playerName)
    ) {
      this.logger.info(`[Container] ${playerName}: not on the guess list.`);
      return;
    }

    if (this.isClosing) {
      this.logger.info(`[Container] ${playerName}: Server is already closing.`);
      return;
    }
    this.isClosing = true;

    if (this.settings.discordWebhookUrl && this.discord) {
      await this.discord.onPlayerLogging(playerName);
    }

    await this.close();
    this.isClosing = false;

    if (this.settings.startMinecraft) {
      const onMcClosed = async () => {
        if (this.settings.discordWebhookUrl && this.discord) {
          await this.discord.onServerStop();
        }

        this.logger.info(
          `[Container] ...Time to kill me if you want (${
            MC_TIMEOUT / 1000
          } secs)...`
        );
        setTimeout(async () => {
          this.reloadSettings();
          this.logger.info("[Container] ...Too late !...");
          await this.init();
        }, MC_TIMEOUT); // restart server
      };

      this.startMinecraft(onMcClosed);
    }
  };

  reloadSettings = () => {
    this.settings = getSettings();
  };

  getStatus = async () => {
    let status = ServerStatus.Stopped;
    if (this.mcServer) {
      status = this.mcServer?.getStatus();
    }
    if (status !== ServerStatus.Sleeping) {
      const portTaken = await isPortTaken(this.settings.serverPort);
      if (portTaken) {
        status = ServerStatus.Running;
      } else {
        status = ServerStatus.Starting;
      }
    }
    return status;
  };
}
