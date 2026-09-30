import './style.css'

const startCameraButton = document.querySelector('#start-camera')
const status = document.querySelector('#status')

startCameraButton.addEventListener('click', () => {
  status.textContent = 'Camera setup is coming in a later step.'
})
