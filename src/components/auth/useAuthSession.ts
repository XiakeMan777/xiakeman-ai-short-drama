export interface AuthSessionContextValue {
  user: null;
  checking: false;
}

// The community UI has no Xiakeman account session. A stable local-only value
// keeps optional background-job panels dormant without contacting auth routes.
const COMMUNITY_SESSION: AuthSessionContextValue = {
  user: null,
  checking: false,
};

export function useAuthSession(): AuthSessionContextValue {
  return COMMUNITY_SESSION;
}
