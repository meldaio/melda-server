const AWS = require('aws-sdk')

AWS.config.update({ region: 'eu-west-1' })
const SES = new AWS.SES()

const masterEmail = process.env.MASTER_EMAIL

module.exports = {
  /**
   * Sends an email to given email adresses by using AWS
   *
   * @param {string} template Which template in AWS will be used. See AWS email tempplates for more information
   * @param {object} templateData The template data object which will be used in the specified template
   * @param {string} source The source email address
   * @param {array} toAddresses The string array of email addresses which the email will be sent to.
   */
  async sendEmail(template, templateData, toAddresses, replyToAddress = '',  noReply = true,  source = masterEmail) {
    const params = {
      Destination: { ToAddresses: toAddresses },
      Source: source,
      Template: template,
      TemplateData: JSON.stringify(templateData),
      ReplyToAddresses: noReply ? [source] : [replyToAddress],
    }

    await SES.sendTemplatedEmail(params).promise()
  },
}
