import { EnglishStrings } from '../lang/en/en.js';

// Change this single value when configuring the future backend origin.
const apiBaseUrl = 'http://localhost:3000';

class ApiError extends Error {
  constructor(status, code) {
    super(code);

    this.status = status;
    this.code = code;
  }
}

class ApiClient {
  async request(path, body) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });

    const data = response.status === 204 ? null : await response.json();

    if (!response.ok) throw new ApiError(response.status, data?.error?.code);

    return data;
  }
}

class Application {
  #api = new ApiClient();
  #page = document.body.dataset.page;

  async start() {
    this.#translate();

    if (this.#page === 'login') {
      this.#initializeLogin();
    } else {
      document.querySelector('#logout').addEventListener('click', (event) => {
        event.preventDefault();
        void this.#logout();
      });

      await this.#loadProtectedPage();

      // A browser back/forward cache restore must also recheck the cookie.
      window.addEventListener('pagehide', () => { document.querySelector('#protected-content').hidden = true; });
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) void this.#loadProtectedPage();
      });
    }
  }

  #translate() {
    document.title = EnglishStrings[this.#page === 'login' ? 'loginTitle' : this.#page];

    for (const element of document.querySelectorAll('[data-text]')) {
      element.textContent = EnglishStrings[element.dataset.text];
    }
  }

  #initializeLogin() {
    const notices = {
      required: EnglishStrings.loginRequired,
      expired: EnglishStrings.sessionExpired,
      logout: EnglishStrings.loggedOut,
    };

    const notice = new URLSearchParams(window.location.search).get('notice');
    this.#message(Object.hasOwn(notices, notice) ? notices[notice] : '');

    document.querySelector('#login-form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#login();
    });
  }

  async #login() {
    const button = document.querySelector('#login-button');
    const password = document.querySelector('#password');

    button.disabled = true;
    button.textContent = EnglishStrings.loggingIn;
    this.#message('');

    try {
      await this.#api.request('/api/login', {
        username: document.querySelector('#username').value,
        password: password.value,
      });

      window.location.replace('admin.html');
    } catch (error) {
      this.#showError(error);
    } finally {
      password.value = '';
      button.disabled = false;
      button.textContent = EnglishStrings.login;
    }
  }

  async #loadProtectedPage() {
    try {
      const path = this.#page === 'admin' ? '/api/admin' : '/api/auth';
      const data = await this.#api.request(path);

      if (this.#page === 'admin') {
        document.querySelector('#welcome').textContent = EnglishStrings.welcome(
          data.secret, new Date().toLocaleString(),
        );
      }

      document.querySelector('#protected-content').hidden = false;
      this.#message('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.location.replace('index.html?notice=required');
      } else {
        this.#showError(error);
      }
    }
  }

  async #logout() {
    try {
      await this.#api.request('/api/logout', {});

      window.location.replace('index.html?notice=logout');
    } catch (error) {
      this.#showError(error);
    }
  }

  #showError(error) {
    const messages = {
      INVALID_CREDENTIALS: EnglishStrings.invalidCredentials,
      INVALID_INPUT: EnglishStrings.invalidInput,
      TOO_MANY_REQUESTS: EnglishStrings.tooManyRequests,
      ORIGIN_DENIED: EnglishStrings.originDenied,
      PAYLOAD_TOO_LARGE: EnglishStrings.payloadTooLarge,
    };

    this.#message(error instanceof ApiError
      ? (messages[error.code] || EnglishStrings.requestError) : EnglishStrings.networkError);
  }

  #message(text) {
    document.querySelector('#message').textContent = text;
  }
}

void new Application().start();
