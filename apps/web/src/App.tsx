import { useEffect, useMemo, useState } from "react";
import { API_BASE, api } from "./api";

type User = {
  id: string;
  fullName: string;
  email: string;
  role: "ADMIN" | "STAFF";
  wfhEnabled?: boolean;
  homeLatitude?: number | null;
  homeLongitude?: number | null;
  isActive?: boolean;
  isApproved?: boolean;
  createdAt?: string;
};

type Attendance = {
  id?: string;
  user?: {
    fullName: string;
    email: string;
  };
  clockInAt?: string;
  clockOutAt?: string;
  workUpdate?: string;
  totalMinutes?: number;
  clockInMode?: "OFFICE" | "WFH";
  clockOutMode?: "OFFICE" | "WFH";
};

type NewStaffForm = {
  fullName: string;
  email: string;
  password: string;
  role: "ADMIN" | "STAFF";
  wfhEnabled: boolean;
  homeLatitude: string;
  homeLongitude: string;
};

function useGeolocation() {
  const [geo, setGeo] = useState<{ latitude: number; longitude: number } | null>(null);

  const fetchGeo = () =>
    new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const value = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          setGeo(value);
          resolve(value);
        },
        (error) => reject(error),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 10000
        }
      );
    });

  return { geo, fetchGeo };
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? (JSON.parse(stored) as User) : null;
    } catch {
      return null;
    }
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signupWorkMode, setSignupWorkMode] = useState<"WFH" | "WFO">("WFH");
  const [message, setMessage] = useState("");
  const [isSigningUp, setIsSigningUp] = useState(false);

  const [wfhCode, setWfhCode] = useState("");
  const [workUpdate, setWorkUpdate] = useState("");
  const [attendance, setAttendance] = useState<Attendance | null>(null);

  const [adminCode, setAdminCode] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState<"ALL" | "WFH_ON" | "WFH_OFF">("ALL");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportRows, setReportRows] = useState<Attendance[]>([]);

  const [newStaff, setNewStaff] = useState<NewStaffForm>({
    fullName: "",
    email: "",
    password: "",
    role: "STAFF",
    wfhEnabled: true,
    homeLatitude: "",
    homeLongitude: ""
  });

  const { geo, fetchGeo } = useGeolocation();

  const todayHours = useMemo(() => {
    if (!attendance?.totalMinutes) return "0.00";
    return (attendance.totalMinutes / 60).toFixed(2);
  }, [attendance]);

  const filteredStaffList = useMemo(() => {
    if (staffFilter === "WFH_ON") {
      return staffList.filter((staff) => (staff.wfhEnabled ?? true) === true);
    }

    if (staffFilter === "WFH_OFF") {
      return staffList.filter((staff) => (staff.wfhEnabled ?? true) === false);
    }

    return staffList;
  }, [staffFilter, staffList]);

  const pendingApprovalUsers = useMemo(() => {
    const fromStaffList = staffList.filter((staff) => staff.isApproved === false);
    if (fromStaffList.length > 0) {
      return fromStaffList;
    }
    return pendingUsers;
  }, [staffList, pendingUsers]);

  useEffect(() => {
    if (!token || !user) return;

    const hydrateDashboard = async () => {
      await loadToday(token);

      if (user.role === "ADMIN") {
        const today = new Date().toISOString().slice(0, 10);
        setReportDate(today);
        await Promise.allSettled([
          loadStaffs(token),
          loadPendingUsers(token),
          loadReport(token, today)
        ]);
      }
    };

    hydrateDashboard().catch((error) => {
      setMessage((error as Error).message);
    });
  }, [token, user]);

  async function login() {
    try {
      const result = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: { email, password }
      });
      setToken(result.token);
      setUser(result.user);
      localStorage.setItem("token", result.token);
      localStorage.setItem("user", JSON.stringify(result.user));
      setMessage("Login successful.");
      await loadToday(result.token);

      if (result.user.role === "ADMIN") {
        const today = new Date().toISOString().slice(0, 10);
        setReportDate(today);
        await Promise.allSettled([
          loadStaffs(result.token),
          loadPendingUsers(result.token),
          loadReport(result.token, today)
        ]);
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function signup() {
    try {
      await api("/auth/register", {
        method: "POST",
        body: {
          fullName,
          email,
          password,
          wfhEnabled: signupWorkMode === "WFH"
        }
      });
      setMessage("Registration successful! Please wait for admin approval to login.");
      setFullName("");
      setEmail("");
      setPassword("");
      setSignupWorkMode("WFH");
      setIsSigningUp(false);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function loadToday(currentToken = token) {
    if (!currentToken) return;
    const data = await api<Attendance | null>("/attendance/today", { token: currentToken });
    setAttendance(data);
  }

  async function submit(type: "clock-in" | "clock-out") {
    if (!token) return;
    if (type === "clock-out" && workUpdate.trim().length < 5) {
      setMessage("Please enter a brief work update before clock out.");
      return;
    }

    try {
      const coords = await fetchGeo();
      await api(`/attendance/${type}`, {
        method: "POST",
        token,
        body: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          wfhCode: wfhCode || undefined,
          workUpdate: type === "clock-out" ? workUpdate.trim() : undefined
        }
      });
      setMessage(`${type} successful.`);
      if (type === "clock-out") {
        setWorkUpdate("");
      }
      await loadToday();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function loadStaffs(currentToken = token) {
    if (!currentToken) return;
    const users = await api<User[]>("/users", { token: currentToken });
    setStaffList(users);
  }

  async function loadPendingUsers(currentToken = token) {
    if (!currentToken) return;
    const users = await api<User[]>("/users/pending", { token: currentToken });
    setPendingUsers(users);
  }

  async function loadReport(currentToken = token, date = reportDate) {
    if (!currentToken) return;
    const rows = await api<Attendance[]>(`/admin/attendance?date=${date}`, { token: currentToken });
    setReportRows(rows);
  }

  async function fillCreateLocationFromCurrent() {
    try {
      const coords = await fetchGeo();
      setNewStaff((prev) => ({
        ...prev,
        homeLatitude: String(coords.latitude),
        homeLongitude: String(coords.longitude)
      }));
      setMessage("Current location captured for new staff.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function fillEditLocationFromCurrent(staffId: string) {
    try {
      const coords = await fetchGeo();
      setStaffList((prev) =>
        prev.map((x) =>
          x.id === staffId
            ? {
                ...x,
                homeLatitude: coords.latitude,
                homeLongitude: coords.longitude
              }
            : x
        )
      );
      setMessage("Current location captured for selected staff.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function createStaff() {
    if (!token) return;

    try {
      await api("/users", {
        method: "POST",
        token,
        body: {
          fullName: newStaff.fullName,
          email: newStaff.email,
          password: newStaff.password,
          role: newStaff.role,
          wfhEnabled: newStaff.wfhEnabled,
          homeLatitude: newStaff.homeLatitude ? Number(newStaff.homeLatitude) : undefined,
          homeLongitude: newStaff.homeLongitude ? Number(newStaff.homeLongitude) : undefined
        }
      });

      setNewStaff({
        fullName: "",
        email: "",
        password: "",
        role: "STAFF",
        wfhEnabled: true,
        homeLatitude: "",
        homeLongitude: ""
      });
      setMessage("Staff account created.");
      await loadStaffs();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function saveStaff(staff: User) {
    if (!token) return;

    try {
      await api(`/users/${staff.id}`, {
        method: "PUT",
        token,
        body: {
          fullName: staff.fullName,
          email: staff.email,
          role: staff.role,
          wfhEnabled: staff.wfhEnabled ?? true,
          homeLatitude: staff.homeLatitude ?? null,
          homeLongitude: staff.homeLongitude ?? null,
          isActive: staff.isActive ?? true
        }
      });
      setEditingStaffId(null);
      setMessage("Staff updated.");
      await loadStaffs();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function deleteStaff(staffId: string) {
    if (!token) return;
    try {
      await api(`/users/${staffId}`, { method: "DELETE", token });
      setMessage("Staff deleted.");
      await loadStaffs();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function generateCode() {
    if (!token) return;
    try {
      const data = await api<{ code: string }>("/admin/wfh-code/generate", {
        method: "POST",
        token
      });
      setAdminCode(data.code);
      setMessage("WFH code generated for today.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function approveUser(userId: string) {
    if (!token) return;
    try {
      await api(`/users/${userId}/approve`, {
        method: "PATCH",
        token,
        body: { approve: true }
      });
      setMessage("User approved.");
      await loadPendingUsers();
      await loadStaffs();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function rejectUser(userId: string) {
    if (!token) return;
    try {
      await api(`/users/${userId}/approve`, {
        method: "PATCH",
        token,
        body: { approve: false }
      });
      setMessage("User rejected.");
      await loadPendingUsers();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function exportCsv() {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/admin/attendance/export.csv`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error("Failed to export CSV.");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "attendance.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  if (!token || !user) {
    return (
      <div className="shell min-h-screen flex items-center justify-center">
        <div className="card w-full max-w-md p-6">
          <h1 className="text-2xl font-bold">Staff Attendance</h1>
          <div className="mt-4 flex gap-2 border-b border-slate-200 mb-4">
            <button
              className={`px-3 py-2 text-sm font-semibold ${
                !isSigningUp ? "border-b-2 border-blue-500 text-blue-600" : "text-slate-600"
              }`}
              onClick={() => setIsSigningUp(false)}
            >
              Sign In
            </button>
            <button
              className={`px-3 py-2 text-sm font-semibold ${
                isSigningUp ? "border-b-2 border-blue-500 text-blue-600" : "text-slate-600"
              }`}
              onClick={() => setIsSigningUp(true)}
            >
              Sign Up
            </button>
          </div>
          <div className="space-y-3">
            {isSigningUp ? (
              <>
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Full name"
                />
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
                <select
                  className="input"
                  value={signupWorkMode}
                  onChange={(e) => setSignupWorkMode(e.target.value as "WFH" | "WFO")}
                >
                  <option value="WFH">WFH</option>
                  <option value="WFO">WFO</option>
                </select>
                <button className="btn btn-primary w-full" onClick={signup}>
                  Create Account
                </button>
                <p className="text-xs text-slate-600">Admin will review and approve your registration.</p>
              </>
            ) : (
              <>
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
                <button className="btn btn-primary w-full" onClick={login}>
                  Sign In
                </button>
              </>
            )}
            <p className="text-sm text-amber-700">{message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell space-y-4">
      <div className="card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">Welcome, {user.fullName}</h2>
            <p className="text-sm opacity-70">Role: {user.role}</p>
          </div>
          <button
            className="btn"
            onClick={() => {
              setToken(null);
              setUser(null);
              setAttendance(null);
              localStorage.removeItem("token");
              localStorage.removeItem("user");
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {user.role === "STAFF" && (
        <div className="card p-5 space-y-3">
          <h3 className="text-lg font-semibold">Today Dashboard</h3>
          <p>Clock In: {attendance?.clockInAt ? new Date(attendance.clockInAt).toLocaleTimeString() : "-"}</p>
          <p>Clock Out: {attendance?.clockOutAt ? new Date(attendance.clockOutAt).toLocaleTimeString() : "-"}</p>
          <p>Total Hours: {todayHours}</p>
          <div>
            <label className="text-sm">WFH Code (required when not in office mode)</label>
            <input className="input mt-1" value={wfhCode} maxLength={6} onChange={(e) => setWfhCode(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Work Update (required before clock out)</label>
            <textarea
              className="input mt-1 min-h-24"
              value={workUpdate}
              onChange={(e) => setWorkUpdate(e.target.value)}
              placeholder="Briefly describe what you completed today"
            />
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => submit("clock-in")}>
              Clock In
            </button>
            <button className="btn btn-accent" onClick={() => submit("clock-out")}>
              Clock Out
            </button>
          </div>
          <p className="text-xs opacity-70">
            Current GPS: {geo ? `${geo.latitude.toFixed(6)}, ${geo.longitude.toFixed(6)}` : "Tap Clock In/Out to capture."}
          </p>
          <p className="text-sm text-amber-700">{message}</p>
        </div>
      )}

      {user.role === "ADMIN" && (
        <div className="space-y-4">
          <div className="card p-5 space-y-3">
            <h3 className="text-lg font-semibold">Admin Panel</h3>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={generateCode}>
                Generate Daily WFH Code
              </button>
              <button className="btn btn-accent" onClick={exportCsv}>
                Export Attendance CSV
              </button>
              <button className="btn" onClick={() => loadReport()}>
                Refresh Report
              </button>
              <button className="btn" onClick={() => loadStaffs()}>
                Refresh Staff List
              </button>
            </div>
            {adminCode && (
              <p className="text-sm">
                Today WFH Code: <strong>{adminCode}</strong>
              </p>
            )}
            <p className="text-sm text-amber-700">{message}</p>
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="text-lg font-semibold">Pending User Approvals ({pendingApprovalUsers.length})</h3>
            {pendingApprovalUsers.length === 0 ? (
              <p className="text-sm text-slate-600">No pending approvals.</p>
            ) : (
              <div className="space-y-2">
                {pendingApprovalUsers.map((pending) => (
                  <div key={pending.id} className="rounded border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="font-semibold">{pending.fullName}</p>
                      <p className="text-sm text-slate-500">{pending.email}</p>
                      <p className="text-xs text-slate-400">Registered: {new Date(pending.createdAt || "").toLocaleDateString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn btn-primary"
                        onClick={() => approveUser(pending.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-accent"
                        onClick={() => rejectUser(pending.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="text-lg font-semibold">Add Staff Account</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                placeholder="Full name"
                value={newStaff.fullName}
                onChange={(e) => setNewStaff((prev) => ({ ...prev, fullName: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Email"
                value={newStaff.email}
                onChange={(e) => setNewStaff((prev) => ({ ...prev, email: e.target.value }))}
              />
              <input
                className="input"
                type="password"
                placeholder="Temporary password"
                value={newStaff.password}
                onChange={(e) => setNewStaff((prev) => ({ ...prev, password: e.target.value }))}
              />
              <select
                className="input"
                value={newStaff.role}
                onChange={(e) => setNewStaff((prev) => ({ ...prev, role: e.target.value as "ADMIN" | "STAFF" }))}
              >
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newStaff.wfhEnabled}
                  onChange={(e) => setNewStaff((prev) => ({ ...prev, wfhEnabled: e.target.checked }))}
                />
                WFH enabled for this staff
              </label>
              {newStaff.wfhEnabled && (
                <>
                  <input
                    className="input"
                    placeholder="Home latitude"
                    value={newStaff.homeLatitude}
                    onChange={(e) => setNewStaff((prev) => ({ ...prev, homeLatitude: e.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Home longitude"
                    value={newStaff.homeLongitude}
                    onChange={(e) => setNewStaff((prev) => ({ ...prev, homeLongitude: e.target.value }))}
                  />
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={fillCreateLocationFromCurrent}>
                Use Current Location
              </button>
              <button className="btn btn-accent" onClick={createStaff}>
                Create Staff
              </button>
            </div>
            <p className="text-xs opacity-70">Home coordinates are optional. WFH now relies on the admin code.</p>
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="text-lg font-semibold">Staff Management</h3>
            <div className="flex flex-wrap gap-2">
              <button
                className={`btn ${staffFilter === "ALL" ? "btn-primary" : ""}`}
                onClick={() => setStaffFilter("ALL")}
              >
                All
              </button>
              <button
                className={`btn ${staffFilter === "WFH_ON" ? "btn-primary" : ""}`}
                onClick={() => setStaffFilter("WFH_ON")}
              >
                WFH Enabled
              </button>
              <button
                className={`btn ${staffFilter === "WFH_OFF" ? "btn-primary" : ""}`}
                onClick={() => setStaffFilter("WFH_OFF")}
              >
                WFH Disabled
              </button>
            </div>
            <p className="text-xs opacity-70">Showing {filteredStaffList.length} of {staffList.length} staff</p>
            <div className="space-y-2">
              {filteredStaffList.map((staff) => (
                <div key={staff.id} className="rounded border border-slate-200 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{staff.role}</span>
                    <span
                      className={`rounded-full px-2 py-1 ${
                        staff.isApproved ?? true ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {(staff.isApproved ?? true) ? "Approved" : "Pending"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 ${
                        staff.wfhEnabled ?? true ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      WFH: {(staff.wfhEnabled ?? true) ? "Enabled" : "Disabled"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 ${
                        staff.isActive ?? true ? "bg-sky-100 text-sky-700" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {(staff.isActive ?? true) ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="input"
                      value={staff.fullName}
                      disabled={editingStaffId !== staff.id}
                      onChange={(e) =>
                        setStaffList((prev) => prev.map((x) => (x.id === staff.id ? { ...x, fullName: e.target.value } : x)))
                      }
                    />
                    <input
                      className="input"
                      value={staff.email}
                      disabled={editingStaffId !== staff.id}
                      onChange={(e) =>
                        setStaffList((prev) => prev.map((x) => (x.id === staff.id ? { ...x, email: e.target.value } : x)))
                      }
                    />
                    <select
                      className="input"
                      value={staff.role}
                      disabled={editingStaffId !== staff.id}
                      onChange={(e) =>
                        setStaffList((prev) => prev.map((x) => (x.id === staff.id ? { ...x, role: e.target.value as "ADMIN" | "STAFF" } : x)))
                      }
                    >
                      <option value="STAFF">Staff</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={staff.wfhEnabled ?? true}
                        disabled={editingStaffId !== staff.id}
                        onChange={(e) =>
                          setStaffList((prev) =>
                            prev.map((x) => (x.id === staff.id ? { ...x, wfhEnabled: e.target.checked } : x))
                          )
                        }
                      />
                      WFH enabled
                    </label>
                    {(staff.wfhEnabled ?? true) && (
                      <>
                        <input
                          className="input"
                          value={staff.homeLatitude ?? ""}
                          placeholder="Home latitude"
                          disabled={editingStaffId !== staff.id}
                          onChange={(e) =>
                            setStaffList((prev) =>
                              prev.map((x) =>
                                x.id === staff.id ? { ...x, homeLatitude: e.target.value ? Number(e.target.value) : null } : x
                              )
                            )
                          }
                        />
                        <input
                          className="input"
                          value={staff.homeLongitude ?? ""}
                          placeholder="Home longitude"
                          disabled={editingStaffId !== staff.id}
                          onChange={(e) =>
                            setStaffList((prev) =>
                              prev.map((x) =>
                                x.id === staff.id ? { ...x, homeLongitude: e.target.value ? Number(e.target.value) : null } : x
                              )
                            )
                          }
                        />
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {editingStaffId === staff.id ? (
                      <>
                        <button className="btn" onClick={() => fillEditLocationFromCurrent(staff.id)}>
                          Use Current Location
                        </button>
                        <button className="btn btn-primary" onClick={() => saveStaff(staff)}>
                          Save
                        </button>
                        <button className="btn" onClick={() => setEditingStaffId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="btn" onClick={() => setEditingStaffId(staff.id)}>
                        Edit
                      </button>
                    )}
                    <button className="btn btn-accent" onClick={() => deleteStaff(staff.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="text-lg font-semibold">Staff Attendance Report</h3>
            <div className="flex flex-wrap gap-2 items-center">
              <input className="input" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
              <button className="btn btn-primary" onClick={() => loadReport(token, reportDate)}>
                View Report
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th className="py-2">Name</th>
                    <th className="py-2">Email</th>
                    <th className="py-2">Clock In</th>
                    <th className="py-2">Clock Out</th>
                    <th className="py-2">Hours</th>
                    <th className="py-2">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-2">{row.user?.fullName || "-"}</td>
                      <td className="py-2">{row.user?.email || "-"}</td>
                      <td className="py-2">{row.clockInAt ? new Date(row.clockInAt).toLocaleTimeString() : "-"}</td>
                      <td className="py-2">{row.clockOutAt ? new Date(row.clockOutAt).toLocaleTimeString() : "-"}</td>
                      <td className="py-2">{((row.totalMinutes || 0) / 60).toFixed(2)}</td>
                      <td className="py-2">{row.clockOutMode || row.clockInMode || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
