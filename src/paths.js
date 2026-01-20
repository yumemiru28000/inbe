export const PATHS = {
  presence: (uid) => `presence/${uid}`,
  names: (uid) => `lobby/names/${uid}`,
  leaderboardTop: `leaderboard/top`,

  sessionCurrent: `session/current`,
  sessionGame: `session/current/game`,
  sessionReady: (uid) => `session/current/ready/${uid}`,
  sessionRecruitingJoiner: `session/current/recruiting/joinerUid`,

  sessionInputs: (uid) => `session/current/inputs/${uid}`,
  sessionClientState: (uid) => `session/current/clientState/${uid}`,
};
