// import { ChildProcess } from "child_process";
// import { SleepingDiscord } from "./sleepingDiscord";
// import { getLogger } from "./sleepingLogger";

// export class SleepingPlugin {

//     logger = getLogger();
//     playerCount = 0;
//     mcProcess: ChildProcess;
//     discord : SleepingDiscord | undefined;
//     timeoutId : NodeJS.Timeout | null = null;

//     constructor(mcProcess: ChildProcess, discord: SleepingDiscord | undefined) {
//         this.mcProcess = mcProcess;
//         this.discord = discord;
//         this.mcProcess.stdout?.on("data", async (data : Buffer) => {
//             let outstr = data.toString('utf-8').trimEnd();
//             console.log(outstr);
//             this.outputController(outstr);    
//         });
//         if (this.playerCount == 0) {
//             this.onNoplayerTimeout();
//         }
//     }

//     outputController = async (data: string) => {
//         if (data.length > 70 && data.endsWith('joined the game')) {
//             let playerName = data.slice(61, data.length - 16);
//             this.onPlayerLogging(playerName);
//         }
//         if (data.length > 70 && data.endsWith('left the game')) {
//             let playerNmae = data.slice(61, data.length - 14);
//             this.onPlayerLeft(playerNmae);
//         }
//     }

//     onPlayerLogging = async (playerName: string) => {
//         this.logger.info(`[Minecraft] ${playerName} 님이 접속하셨습니다.`);
//         this.playerCount++;
//         if (this.timeoutId) {
//             clearTimeout(this.timeoutId);
//             this.timeoutId = null;
//         }
//         await this.discord?.onPlayerJoin(playerName);
//     }

//     onPlayerLeft = async (playerName: string) => {
//         this.logger.info(`[Minecraft] ${playerName} 님이 떠나셨습니다.`);
//         this.playerCount--;
//         if (this.playerCount == 0) {
//             this.onNoplayerTimeout();
//         }
//         await this.discord?.onPlayerLeft(playerName);
//     }
    
//     onNoplayerTimeout = async () => {
//         this.logger.info(`[Minecraft] 플레이어가 없습니다. 10분 후 서버가 종료됩니다.`);
//         this.timeoutId = setTimeout(() => {
//             if (this.playerCount == 0) {
//                 this.logger.info(`[Minecraft] 서버가 종료됩니다.`);
//                 this.mcProcess.stdin?.write('stop\n');
//             }
//         }, 600000);
//     }
// }