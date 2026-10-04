import Tesseract from 'tesseract.js';

export const extractTextFromImage = async (imageBuffer) => {
  try {
    const result = await Tesseract.recognize(
      imageBuffer,
      'eng',
      {
        logger: (info) => {
          console.log(
            `OCR: ${info.status} ${Math.round((info.progress || 0) * 100)}%`
          );
        }
      }
    );

    const text = result.data.text?.trim() || '';

    return {
      success: true,
      text,
      confidence: result.data.confidence || 0
    };
  } catch (error) {
    console.error('OCR Error:', error);

    return {
      success: false,
      text: '',
      confidence: 0,
      error: error.message
    };
  }
};