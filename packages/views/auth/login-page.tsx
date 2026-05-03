"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import { Button } from "@multica/ui/components/ui/button";
import { Label } from "@multica/ui/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@multica/ui/components/ui/input-otp";
import { useAuthStore } from "@multica/core/auth";
import { workspaceKeys } from "@multica/core/workspace/queries";
import { api } from "@multica/core/api";
import type { User } from "@multica/core/types";
import { AvatarPicker, defaultAvatarFor } from "../common/avatar-picker";

interface GoogleAuthConfig {
  clientId: string;
  redirectUri: string;
  state?: string;
}

interface CliCallbackConfig {
  url: string;
  state: string;
}

interface LoginPageProps {
  logo?: ReactNode;
  onSuccess: () => void;
  google?: GoogleAuthConfig;
  cliCallback?: CliCallbackConfig;
  onTokenObtained?: () => void;
  onGoogleLogin?: () => void;
  extra?: ReactNode;
  mode?: "web" | "local";
}

const LAST_NAME_KEY = "origin_last_signin_name";
const LAST_AVATAR_KEY = "origin_last_signin_avatar";

function readStorage(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota and private-mode failures; login itself should continue.
  }
}

function redirectToCliCallback(url: string, token: string, state: string) {
  const separator = url.includes("?") ? "&" : "?";
  window.location.href = `${url}${separator}token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
}

export function validateCliCallback(cliCallback: string): boolean {
  try {
    const cbUrl = new URL(cliCallback);
    if (cbUrl.protocol !== "http:") return false;

    const host = cbUrl.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      return true;
    }

    const parts = host.split(".").map((part) => Number(part));
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return false;
    }

    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  } catch {
    return false;
  }
}

export function LoginPage({
  logo,
  onSuccess,
  google,
  cliCallback,
  onTokenObtained,
  onGoogleLogin,
  extra,
  mode = "web",
}: LoginPageProps) {
  if (mode === "local") {
    return (
      <LocalLoginPage
        logo={logo}
        onSuccess={onSuccess}
        onTokenObtained={onTokenObtained}
        extra={extra}
      />
    );
  }

  return (
    <WebLoginPage
      logo={logo}
      onSuccess={onSuccess}
      google={google}
      cliCallback={cliCallback}
      onTokenObtained={onTokenObtained}
      onGoogleLogin={onGoogleLogin}
      extra={extra}
    />
  );
}

function LocalLoginPage({
  logo,
  onSuccess,
  onTokenObtained,
  extra,
}: Pick<LoginPageProps, "logo" | "onSuccess" | "onTokenObtained" | "extra">) {
  const qc = useQueryClient();
  const [name, setName] = useState(() => readStorage(LAST_NAME_KEY));
  // Default avatar is deterministic based on the (possibly empty) saved name.
  // Once the user types a different name in the form, the previously-selected
  // avatar from localStorage stays put — only the *initial* default tracks the
  // saved name, so we don't yank the avatar around on every keystroke.
  const [avatar, setAvatar] = useState(
    () => readStorage(LAST_AVATAR_KEY) || defaultAvatarFor(readStorage(LAST_NAME_KEY)),
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("先给自己起个名字");
      return;
    }
    if (trimmed.length > 32) {
      setError("名字最多 32 个字符");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await useAuthStore.getState().localSignIn(trimmed, avatar);
      writeStorage(LAST_NAME_KEY, trimmed);
      writeStorage(LAST_AVATAR_KEY, avatar);
      const wsList = await api.listWorkspaces();
      qc.setQueryData(workspaceKeys.list(), wsList);
      onTokenObtained?.();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "进入工作台失败");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {logo ? <div className="mb-3">{logo}</div> : null}
          <CardTitle className="text-xl">欢迎来到原点工作台</CardTitle>
          <CardDescription>
            本地的智能体工作台。给自己起个名字，选个头像，就能进。
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 text-sm font-medium">头像</div>
              <AvatarPicker
                value={avatar}
                onChange={setAvatar}
                idPrefix="signin-avatar"
                tileSize={52}
              />
            </div>

            <div>
              <Label htmlFor="signin-name" className="mb-2 block">
                名字
              </Label>
              <Input
                id="signin-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你怎么称呼自己？"
                maxLength={32}
                autoFocus
                disabled={loading}
              />
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              className="h-10 w-full"
              disabled={loading || !name.trim()}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              进入工作台
            </Button>
          </CardContent>

          {extra ? <CardFooter>{extra}</CardFooter> : null}
        </form>
      </Card>
    </div>
  );
}

function WebLoginPage({
  logo,
  onSuccess,
  google,
  cliCallback,
  onTokenObtained,
  onGoogleLogin,
  extra,
}: Omit<LoginPageProps, "mode">) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"email" | "code" | "cli_confirm">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [existingUser, setExistingUser] = useState<User | null>(null);
  const authSourceRef = useRef<"cookie" | "localStorage">("cookie");

  useEffect(() => {
    if (!cliCallback) return;

    api.setToken(null);

    api
      .getMe()
      .then((user) => {
        authSourceRef.current = "cookie";
        setExistingUser(user);
        setStep("cli_confirm");
      })
      .catch(() => {
        const token = localStorage.getItem("multica_token");
        if (!token) return;

        api.setToken(token);
        api
          .getMe()
          .then((user) => {
            authSourceRef.current = "localStorage";
            setExistingUser(user);
            setStep("cli_confirm");
          })
          .catch(() => {
            api.setToken(null);
            localStorage.removeItem("multica_token");
          });
      });
  }, [cliCallback]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSendCode = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!email) {
        setError("邮箱不能为空");
        return;
      }
      setLoading(true);
      setError("");
      try {
        await useAuthStore.getState().sendCode(email);
        setStep("code");
        setCode("");
        setCooldown(60);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "发送验证码失败，请确认服务正在运行。",
        );
      } finally {
        setLoading(false);
      }
    },
    [email],
  );

  const handleVerify = useCallback(
    async (value: string) => {
      if (value.length !== 6) return;
      setLoading(true);
      setError("");
      try {
        if (cliCallback) {
          const { token } = await api.verifyCode(email, value);
          localStorage.setItem("multica_token", token);
          api.setToken(token);
          onTokenObtained?.();
          redirectToCliCallback(cliCallback.url, token, cliCallback.state);
          return;
        }

        await useAuthStore.getState().verifyCode(email, value);
        const wsList = await api.listWorkspaces();
        qc.setQueryData(workspaceKeys.list(), wsList);
        onTokenObtained?.();
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "验证码无效或已过期");
        setCode("");
        setLoading(false);
      }
    },
    [email, onSuccess, cliCallback, onTokenObtained, qc],
  );

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError("");
    try {
      await useAuthStore.getState().sendCode(email);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新发送验证码失败");
    }
  };

  const handleCliAuthorize = async () => {
    if (!cliCallback) return;
    setLoading(true);

    try {
      let token: string;

      if (authSourceRef.current === "localStorage") {
        const stored = localStorage.getItem("multica_token");
        if (!stored) throw new Error("token missing");
        token = stored;
      } else {
        const res = await api.issueCliToken();
        token = res.token;
      }

      onTokenObtained?.();
      redirectToCliCallback(cliCallback.url, token, cliCallback.state);
    } catch {
      setError("CLI 授权失败，请重新登录。");
      setExistingUser(null);
      setStep("email");
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (onGoogleLogin) {
      onGoogleLogin();
      return;
    }
    if (!google) return;

    const params = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: google.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    if (google.state) params.set("state", google.state);
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  if (step === "cli_confirm" && existingUser) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            {logo ? <div className="mx-auto mb-4">{logo}</div> : null}
            <CardTitle className="text-2xl">授权 CLI</CardTitle>
            <CardDescription>
              允许 CLI 以{" "}
              <span className="font-medium text-foreground">
                {existingUser.email}
              </span>{" "}
              的身份访问 Multica？
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleCliAuthorize}
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading ? "授权中..." : "授权"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setExistingUser(null);
                setStep("email");
              }}
            >
              使用其他账号
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "code") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            {logo ? <div className="mx-auto mb-4">{logo}</div> : null}
            <CardTitle className="text-2xl">查看邮箱</CardTitle>
            <CardDescription>
              我们已向{" "}
              <span className="font-medium text-foreground">{email}</span>{" "}
              发送验证码
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6) void handleVerify(value);
              }}
              disabled={loading}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0}
                className="text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                {cooldown > 0 ? `${cooldown} 秒后可重发` : "重新发送验证码"}
              </button>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              返回
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {logo ? <div className="mx-auto mb-4">{logo}</div> : null}
          <CardTitle className="text-2xl">登录 Multica</CardTitle>
          <CardDescription>输入邮箱获取登录验证码</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="login-form" onSubmit={handleSendCode} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email">邮箱</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            form="login-form"
            className="w-full"
            size="lg"
            disabled={!email || loading}
          >
            {loading ? "发送中..." : "继续"}
          </Button>
          {(google || onGoogleLogin) ? (
            <>
              <div className="relative w-full">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">或</span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                size="lg"
                onClick={handleGoogleLogin}
                disabled={loading}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                使用 Google 继续
              </Button>
            </>
          ) : null}
          {extra ? <div className="w-full pt-1 text-center">{extra}</div> : null}
        </CardFooter>
      </Card>
    </div>
  );
}
