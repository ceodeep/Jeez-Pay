import axios from "axios";

const api = axios.create({
  baseURL: "https://api.jeezpay.co/",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * A rejected token used to leave the dashboard looking signed-in but empty.
 * Any 401 on an authenticated call now drops the token and returns to login.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && localStorage.getItem("admin_token")) {
      localStorage.removeItem("admin_token");
      window.dispatchEvent(new Event("admin:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export default api;