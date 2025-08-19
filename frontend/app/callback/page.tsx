'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const code = query.get('code')

    if (!code) {
      console.error('No code found in URL.')
      return
    }

    // Debug: Check localStorage
    const storedVerifier = localStorage.getItem('code_verifier')
    console.log('Stored code verifier:', storedVerifier)
    console.log('All localStorage keys:', Object.keys(localStorage))

    // Debug: Log the data being sent
    const codeVerifier = localStorage.getItem('code_verifier')
    if (!codeVerifier) {
      console.error('No code verifier found in localStorage. This might happen if:')
      console.error('1. The page was refreshed')
      console.error('2. localStorage was cleared')
      console.error('3. There was an error during the initial login')
      console.error('Please try logging in again.')
      // Clear any stale data and redirect to login
      localStorage.clear()
      router.push('/')
      return
    }
    
    const requestData = {
      code,
      redirect_uri: `${window.location.origin}/callback`,
      code_verifier: codeVerifier,
    }
    console.log('Sending to backend:', requestData)
    
    // Send the code to the backend to exchange for access token
    fetch('/api/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    })
      .then(res => {
        console.log('Response status:', res.status)
        return res.json()
      })
      .then(data => {
        console.log('Response data:', data)
        if (data.access_token) {
          localStorage.setItem('access_token', data.access_token)
          router.push('/')
        } else {
          console.error('Error retrieving access token:', data)
          // If there's an authentication error, clear localStorage and redirect
          if (data.error || data.error_description) {
            console.error('Authentication failed. Please try again.')
            localStorage.clear()
            router.push('/')
          }
        }
      })
      .catch(err => {
        console.error('Auth error:', err)
        console.error('Network or server error. Please try again.')
        localStorage.clear()
        router.push('/')
      })
  }, [router])

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">Authenticating…</h1>
      <p>One moment while we log you in with Spotify.</p>
    </div>
  )
}