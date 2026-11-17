export const EnglishStrings = Object.freeze({
  loginTitle: 'Team prjD5 — Login',
  teamHeading: 'Team prjD5',
  username: 'Username',
  password: 'Password',
  login: 'Login',
  loggingIn: 'Logging in…',

  admin: 'Admin Landing Page',
  page1: 'Page 1',
  page2: 'Page 2',
  logout: 'Logout',

  loginRequired: 'Please log in to continue.',
  sessionExpired: 'Your session has expired. Please log in again.',
  loggedOut: 'You have been logged out.',

  networkError: 'Unable to reach the server. Please try again.',
  requestError: 'The request could not be completed. Please try again.',
  invalidCredentials: 'Invalid username or password.',
  invalidInput: 'Enter a username and a password of up to 6 characters.',
  tooManyRequests: 'Too many login attempts. Please wait a minute and try again.',
  originDenied: 'This frontend origin is not allowed by the server configuration.',
  payloadTooLarge: 'The submitted information is too large.',

  welcome: (secret, time) => `Welcome to Team prjD5, Secret: "${secret}", Time: ${time}`,
});
