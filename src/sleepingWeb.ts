import express, { Express } from "express";
import { engine } from "express-handlebars";
import * as http from "http";
import path from "path";
import { SleepingDiscord } from "./sleepingDiscord";
import { getFavIcon, getMOTD, ServerStatus } from "./sleepingHelper";
import { getLogger, LoggerType } from "./sleepingLogger";
import { ISleepingServer } from "./sleepingServerInterface";
import { Settings } from "./sleepingSettings";
import { Player, PlayerConnectionCallBackType } from "./sleepingTypes";
import { Socket } from "node:net";
import { ping } from "minecraft-protocol";
import { exec } from "child_process";

export class SleepingWeb implements ISleepingServer {
  settings: Settings;
  playerConnectionCallBack: PlayerConnectionCallBackType;
  logger: LoggerType;
  app: Express;
  server?: http.Server;
  webPath = "";
  waking = false
  noOneKillEvent?: NodeJS.Timeout = undefined
  status = -1
  discord: SleepingDiscord;

  PING_INTERVAL = 10000 as const; // 10 seconds
  STOPPING_TIMEOUT_MIN = 10 as const; // 10 minutes

  constructor(
    settings: Settings
  ) {
    this.settings = settings;
    this.discord = new SleepingDiscord(settings);
    if (this.settings.webSubPath) {
      this.webPath = this.settings.webSubPath;
    }
    this.playerConnectionCallBack = this.startMinecraft;

    this.logger = getLogger();
    this.app = express();
    this.pingEvent()
  }
  
  pingEvent = async () => {
    this.getOnlineUserCnt().then((status) => {
      this.status = status
      if ( this.waking && (this.status == undefined || this.status >= 0 ) ) {
        this.discord.onServerStart()
        this.waking = false
      }
  
      if ( this.noOneKillEvent == undefined && ( this.status == 0 || this.status == undefined )) {
  
        this.logger.info(`[WebServer] No one is on the server, starting the ${this.STOPPING_TIMEOUT_MIN} minute timer.`)
        this.noOneKillEvent = setTimeout(async () => {
          if (this.status == 0 || this.status == undefined) {
            this.logger.info(`[WebServer] No one is on the server, stopping the server.`)
            this.killMinecraft(false);
          }
          this.noOneKillEvent = undefined
        }, this.STOPPING_TIMEOUT_MIN * 60000 ); // 10 minutes
  
      }
  
      else if (this.noOneKillEvent && this.status != undefined && this.status > 0) {
        this.logger.info(`[WebServer] Someone joined the server, stopping the 10 minute timer.`)
        clearTimeout(this.noOneKillEvent);
        this.noOneKillEvent = undefined
      }
      setTimeout(this.pingEvent, this.PING_INTERVAL);
    });
    
  }
  

  getIp = (socket: Socket) => {
    return this.settings.hideIpInLogs ? "" : `(${socket.remoteAddress})`;
  };

  init = async () => {
    this.app.engine(
      "hbs",
      engine({
        defaultLayout: "main",
        layoutsDir: path.join(__dirname, "./views/layouts/"),
        extname: ".hbs",
        helpers: {
          title: () => {
            return getMOTD(this.settings, "plain", true);
          },
          motd: () => {
            return getMOTD(this.settings, "html", true);
          },
          favIcon: () => {
            return getFavIcon(this.settings);
          },
          stylesheet: () => {
            return `${this.webPath}/layouts/main.css`;
          },
        },
      })
    );

    this.app.set("view engine", "hbs");
    this.app.use(
      `${this.webPath}/layouts`,
      express.static(path.join(__dirname, "./views/layouts"))
    );

    this.app.use(
      `${this.webPath}/res`,
      express.static(path.join(__dirname, "./views/res"))
    );

    // this.configureDynmap();

    this.app.get(`${this.webPath}/`, (req, res) => {
      res.render(path.join(__dirname, "./views/home"), {
        message: this.settings.loginMessage,
      });
    });

    this.app.post(`${this.webPath}/wakeup`, async (req, res) => {
      res.send("received");

      const currentStatus = this.resolveStatus(await this.getOnlineUserCnt());


      switch (currentStatus) {
        case ServerStatus.Sleeping:
          {
            this.logger.info(
              `[WebServer]${this.getIp(
                req.socket
              )} Wake up server was ${currentStatus}`
            );
            this.playerConnectionCallBack(Player.web());
            this.waking = true
          }
          break;
        case ServerStatus.Running:
          {
            this.logger.info(
              `[WebServer]${this.getIp(
                req.socket
              )} Stopping server was ${currentStatus}`
            );
            this.killMinecraft(false);
          }
          break;
        case ServerStatus.Starting:
          {
            this.logger.info(
              `[WebServer]${this.getIp(
                req.socket
              )} Doing nothing server was ${currentStatus}`
            );
          }
          break;
        default: {
          this.logger.warn(
            `[WebServer]${this.getIp(req.socket)} Server is ?! ${currentStatus}`
          );
        }
      }
    });

    this.app.post(`${this.webPath}/restart`, async (req, res) => {
      res.send("received");

      this.logger.info(
        `[WebServer]${this.getIp(
          req.socket
        )} Restart server`
      );

      this.killMinecraft(true);
    })

    this.app.get(`${this.webPath}/status`, async (req, res) => {
      const status = this.resolveStatus(this.status);
      res.json({
        status,
        dynmap: this.settings.webServeDynmap,
        settings: {
          preventStop: this.settings.preventStop ?? false,
          webAllowRestart: this.settings.webAllowRestart,
        },
      });
    });

    this.server = this.app.listen(this.settings.webPort, () => {
      this.logger.info(
        `[WebServer] Starting web server on *: ${this.settings.webPort}`
      );
    });
  };

  // configureDynmap = () => {
  //   if (this.settings.webServeDynmap) {
  //     let dynmapPath;
  //     if (typeof this.settings.webServeDynmap === "string") {
  //       dynmapPath = this.settings.webServeDynmap;
  //       if (dynmapPath.includes("http")) {
  //         return;
  //       }
  //     } else {
  //       dynmapPath = path.join(getMinecraftDirectory(this.settings), "plugins/dynmap/web");
  //     }
  //     this.logger.info(`[WebServer] Serving dynmap: ${dynmapPath}`);
  //     if (existsSync(dynmapPath)) {
  //       this.app.use(`${this.webPath}/dynmap`, express.static(dynmapPath));
  //     } else {
  //       this.logger.error(`Dynmap directory at ${dynmapPath} does not exist!`);
  //     }
  //   }
  // };

  getOnlineUserCnt = async () => {
    this.logger.info(`[WebServer] Getting server status`);
    let pingres = await ping({host:"craft.seni.kr", port:25565, version: "1.19.4", closeTimeout: 2000}).catch((e) => {return -1})
    if (typeof pingres == "number") {
      this.logger.info(`[WebServer] Server is not responding`)
      return pingres
    }
    if ("playerCount" in pingres) {
      this.logger.info(`[WebServer] Server is responding with ${pingres.playerCount} players`)
      return pingres.playerCount
    } else if ("players" in pingres) {
      this.logger.info(`[WebServer] Server is responding with ${pingres.players.online} players`)
      return pingres.players.online;
    } else {
      this.logger.info(`[WebServer] Server is not responding`)
      return -1;
    }
  }

  resolveStatus = (status: number) => {
    let resolvedStatus = "";

    if (status == -1) {
      if (this.waking) resolvedStatus = ServerStatus.Starting
      else resolvedStatus = ServerStatus.Sleeping
    }
    else {
      resolvedStatus = ServerStatus.Running
    }
    return resolvedStatus
  }

  startMinecraft = async (player: Player) => {
    this.logger.info(`[WebServer] Starting Minecraft Server`);
    if (this.settings.minecraftCommand) {
      let proc = exec(this.settings.minecraftCommand, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`[WebServer] Error starting server: ${error}`);
          return;
        }
        if (stderr) {
          this.logger.warn(`[WebServer] Error/Warn starting server: ${stderr}`);
        }
        this.logger.info(`[WebServer] Started server: ${stdout}\n------------------`);
      });
    }
    else {
      this.logger.error(
        `[WebServer] No start command defined, cannot start the server`
      );
    }
  }

  killMinecraft = async (restart: boolean) => {
    this.logger.info(
      `[WebServer] Killing Minecraft Server, restart: ${restart}`
    );
    if (this.settings.stopCommand) {
      let proc = exec(this.settings.stopCommand, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`[WebServer] Error stopping server: ${error}`);
          return;
        }
        if (stderr) {
          this.logger.error(`[WebServer] Error stopping server: ${stderr}`);
        }
        this.logger.info(`[WebServer] Stopped server: ${stdout}\n------------------`);
        this.discord.onServerStop()
      });
      
      if (restart) {
        proc.on('exit', () => { this.playerConnectionCallBack(Player.web()) });
      }
    }
    else {
      this.logger.error(
        `[WebServer] No stop command defined, cannot stop the server`
      );
    }
    
  }

  close = async () => {
    if (this.server) {
      this.server.close();
    }
  };
}
