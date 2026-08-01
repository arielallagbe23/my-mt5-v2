import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { AuthContext } from './authContext'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const signup = useCallback(async (email, password) => {
    const newUser = await api.signup(email, password)
    setUser(newUser)
    return newUser
  }, [])

  const login = useCallback(async (email, password) => {
    const loggedInUser = await api.login(email, password)
    setUser(loggedInUser)
    return loggedInUser
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
  }, [])

  const updateProfile = useCallback(async (pseudo) => {
    const updatedUser = await api.updateProfile(pseudo)
    setUser(updatedUser)
    return updatedUser
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
