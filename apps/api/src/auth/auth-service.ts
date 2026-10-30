import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export interface AuthAccount {
  userId: string;
  organizationId: string;
  email: string;
  role: "owner" | "admin" | "member";
}

export interface AuthRepository {
  hasOwner(): Promise<boolean>;
  bootstrapOwnerWithPassword(input: {
    email: string;
    organizationName: string;
    passwordHash: string;
  }): Promise<AuthAccount>;
  findUserForLogin(email: string): Promise<
    | (AuthAccount & {
        passwordHash: string | null;
      })
    | null
  >;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<
    | (AuthAccount & {
        expiresAt: Date;
        revokedAt: Date | null;
      })
    | null
  >;
}

export interface AuthServiceOptions {
  now?: () => Date;
  randomToken?: () => string;
  bootstrapToken?: string;
}

export interface AuthResult {
  account: AuthAccount;
  sessionToken: string;
}

const passwordCost = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export class AuthService {
  private readonly now: () => Date;
  private readonly randomToken: () => string;
  private readonly bootstrapToken: string | undefined;

  public constructor(
    private readonly repository: AuthRepository,
    options: AuthServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.randomToken = options.randomToken ?? createSessionToken;
    this.bootstrapToken = options.bootstrapToken;
  }

  public async bootstrapOwner(input: {
    email: string;
    organizationName: string;
    password: string;
    bootstrapToken: string;
  }): Promise<AuthResult> {
    validateBootstrapInput(input);
    validateBootstrapToken(input.bootstrapToken, this.bootstrapToken);

    if (await this.repository.hasOwner()) {
      throw new Error("OWNER_ALREADY_BOOTSTRAPPED");
    }

    const account = await this.repository.bootstrapOwnerWithPassword({
      email: normalizeEmail(input.email),
      organizationName: input.organizationName.trim(),
      passwordHash: await hashPassword(input.password),
    });

    return this.createSession(account);
  }

  public async login(input: {
    email: string;
    password: string;
  }): Promise<AuthResult | null> {
    const account = await this.repository.findUserForLogin(
      normalizeEmail(input.email),
    );

    if (!account?.passwordHash) {
      await consumePasswordCost(input.password);
      return null;
    }

    if (!(await verifyPassword(input.password, account.passwordHash))) {
      return null;
    }

    return this.createSession(account);
  }

  public async authenticateSession(token: string): Promise<AuthAccount | null> {
    if (!isWellFormedSessionToken(token)) {
      return null;
    }

    const session = await this.repository.findSessionByTokenHash(
      hashToken(token),
    );

    if (!session || session.revokedAt || session.expiresAt <= this.now()) {
      return null;
    }

    return {
      userId: session.userId,
      organizationId: session.organizationId,
      email: session.email,
      role: session.role,
    };
  }

  private async createSession(account: AuthAccount): Promise<AuthResult> {
    const sessionToken = this.randomToken();
    const expiresAt = new Date(this.now().getTime() + sessionLifetimeMs);

    await this.repository.createSession({
      userId: account.userId,
      tokenHash: hashToken(sessionToken),
      expiresAt,
    });

    return { account, sessionToken };
  }
}

const validateBootstrapInput = (input: {
  email: string;
  organizationName: string;
  password: string;
}) => {
  if (!normalizeEmail(input.email).includes("@")) {
    throw new Error("INVALID_EMAIL");
  }

  if (input.organizationName.trim().length === 0) {
    throw new Error("INVALID_ORGANIZATION_NAME");
  }

  if (input.password.length < 15) {
    throw new Error("PASSWORD_TOO_SHORT");
  }
};

const validateBootstrapToken = (
  providedToken: string,
  expectedToken: string | undefined,
) => {
  if (!expectedToken) {
    throw new Error("BOOTSTRAP_UNAVAILABLE");
  }

  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new Error("BOOTSTRAP_NOT_AUTHORIZED");
  }
};

const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await deriveKey(password, salt);

  return `scrypt-v1$${salt}$${derivedKey.toString("base64url")}`;
};

const verifyPassword = async (password: string, passwordHash: string) => {
  const [version, salt, encodedKey] = passwordHash.split("$");

  if (version !== "scrypt-v1" || !salt || !encodedKey) {
    return false;
  }

  const storedKey = Buffer.from(encodedKey, "base64url");
  const derivedKey = await deriveKey(password, salt);

  return (
    storedKey.length === derivedKey.length &&
    timingSafeEqual(storedKey, derivedKey)
  );
};

const deriveKey = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, passwordCost, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });

const consumePasswordCost = async (password: string) => {
  await deriveKey(password, "resend-mailbox-login-timing-salt-v1");
};

const createSessionToken = () => randomBytes(32).toString("base64url");

const isWellFormedSessionToken = (token: string) =>
  /^[A-Za-z0-9_-]{32,}$/.test(token);

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

const normalizeEmail = (email: string) => email.trim().toLowerCase();
